import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import List

from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter(prefix="/api/scierc", tags=["SciERC Relation Graph"])


# 네 로컬 모델 프로젝트 경로
SCIERC_PROJECT = Path(
    os.environ.get(
        "SCIERC_PROJECT_DIR",
        r"C:\Users\samsung-user\Desktop\scierc_pure_project",
    )
)

PURE = SCIERC_PROJECT / "external" / "PURE"
ENTITY_DIR = SCIERC_PROJECT / "models" / "fine_tuned" / "entity"
REL_DIR = SCIERC_PROJECT / "models" / "fine_tuned" / "relation"

TMP = SCIERC_PROJECT / "outputs" / "beyond_relevance_demo"
PURE_JSON = TMP / "pure_json"

TMP.mkdir(parents=True, exist_ok=True)
PURE_JSON.mkdir(parents=True, exist_ok=True)


class ExtractRequest(BaseModel):
    abstracts: List[str]


def sent_tokenize(text: str):
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s for s in sentences if s.strip()]


def word_tokenize(sent: str):
    return re.findall(r"[A-Za-z0-9]+|[^\sA-Za-z0-9]", sent)


def span_text(tokens, start, end):
    return " ".join(tokens[start:end + 1]).replace(" ##", "")


def write_pure_json(abstracts: List[str]):
    docs = []

    for i, abstract in enumerate(abstracts, start=1):
        sentences = [word_tokenize(s) for s in sent_tokenize(abstract)]

        doc = {
            "doc_key": f"abstract_{i:03d}",
            "sentences": sentences,
            "ner": [[] for _ in sentences],
            "relations": [[] for _ in sentences],
            "clusters": [],
        }
        docs.append(doc)

    for name in ["dev.json", "test.json"]:
        with open(PURE_JSON / name, "w", encoding="utf-8") as f:
            for doc in docs:
                f.write(json.dumps(doc, ensure_ascii=False) + "\n")

    return len(docs)


def run_cmd(cmd, cwd):
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PURE) + os.pathsep + str(SCIERC_PROJECT)

    p = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    if p.returncode != 0:
        raise RuntimeError(p.stdout)

    return p.stdout


def run_entity():
    # stale prediction 방지
    for f in ["ent_pred_demo.json", "ent_pred_dev_demo.json"]:
        target = ENTITY_DIR / f
        if target.exists():
            target.unlink()

    cmd = [
        sys.executable,
        "run_entity.py",
        "--context_window",
        "0",
        "--task",
        "scierc",
        "--data_dir",
        str(PURE_JSON),
        "--model",
        str(ENTITY_DIR),
        "--bert_model_dir",
        str(ENTITY_DIR),
        "--output_dir",
        str(ENTITY_DIR),
        "--do_eval",
        "--eval_test",
        "--dev_pred_filename",
        "ent_pred_dev_demo.json",
        "--test_pred_filename",
        "ent_pred_demo.json",
    ]

    return run_cmd(cmd, PURE)


def run_relation():
    pred_file = REL_DIR / "rel_pred_demo.json"
    if pred_file.exists():
        pred_file.unlink()

    cmd = [
        sys.executable,
        "run_relation.py",
        "--task",
        "scierc",
        "--model",
        str(REL_DIR),
        "--do_lower_case",
        "--context_window",
        "0",
        "--max_seq_length",
        "128",
        "--entity_output_dir",
        str(ENTITY_DIR),
        "--entity_predictions_test",
        "ent_pred_demo.json",
        "--output_dir",
        str(REL_DIR),
        "--prediction_file",
        "rel_pred_demo.json",
        "--no_cuda",
        "--do_eval",
        "--eval_test",
    ]

    return run_cmd(cmd, PURE)


def build_graph_response():
    pred_path = REL_DIR / "rel_pred_demo.json"

    docs = [
        json.loads(line)
        for line in pred_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    entity_type = {}
    edge_counter = defaultdict(lambda: {"count": 0, "docs": set()})

    for doc in docs:
        tokens = []
        for sent in doc["sentences"]:
            tokens.extend(sent)

        for sent_ner in doc.get("predicted_ner", []):
            for start, end, label in sent_ner:
                text = span_text(tokens, start, end)
                entity_type[text] = label

        for sent_rel in doc.get("predicted_relations", []):
            for s1, e1, s2, e2, rel in sent_rel:
                h = span_text(tokens, s1, e1)
                t = span_text(tokens, s2, e2)

                key = (h, rel, t)
                edge_counter[key]["count"] += 1
                edge_counter[key]["docs"].add(doc["doc_key"])

    nodes = []
    edges = []
    added_nodes = set()

    color_by_type = {
        "Method": "#4C78A8",
        "Task": "#54A24B",
        "Material": "#F58518",
        "Metric": "#E45756",
        "Generic": "#B279A2",
        "OtherScientificTerm": "#72B7B2",
        "Entity": "#999999",
    }

    triples = []

    for (h, rel, t), info in edge_counter.items():
        for node in [h, t]:
            if node not in added_nodes:
                etype = entity_type.get(node, "Entity")
                nodes.append(
                    {
                        "data": {
                            "id": node,
                            "label": node,
                            "type": etype,
                            "color": color_by_type.get(etype, "#999999"),
                        }
                    }
                )
                added_nodes.add(node)

        count = info["count"]
        docs_used = sorted(info["docs"])

        edges.append(
            {
                "data": {
                    "id": f"{h}__{rel}__{t}",
                    "source": h,
                    "target": t,
                    "label": rel,
                    "support": count,
                    "documents": docs_used,
                }
            }
        )

        triples.append(
            {
                "entity1": h,
                "relation": rel,
                "entity2": t,
                "support": count,
                "documents": docs_used,
            }
        )

    return {
        "nodes": nodes,
        "edges": edges,
        "triples": triples,
        "num_nodes": len(nodes),
        "num_edges": len(edges),
    }


@router.post("/extract")
def extract_graph(req: ExtractRequest):
    abstracts = [a.strip() for a in req.abstracts if a and a.strip()]

    if not abstracts:
        return {
            "nodes": [],
            "edges": [],
            "triples": [],
            "num_nodes": 0,
            "num_edges": 0,
        }

    n_docs = write_pure_json(abstracts)
    run_entity()
    run_relation()

    result = build_graph_response()
    result["num_abstracts"] = n_docs
    return result