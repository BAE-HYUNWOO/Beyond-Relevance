from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import List

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
import os
from pathlib import Path
from huggingface_hub import snapshot_download

BASE_DIR = Path(__file__).resolve().parents[2]
MODEL_CACHE_DIR = BASE_DIR / "models" / "hf_cache"

ENTITY_MODEL_REPO = os.environ.get(
    "ENTITY_MODEL_REPO",
    "BAE-HYUNWOO/scierc-entity-model",
)

RELATION_MODEL_REPO = os.environ.get(
    "RELATION_MODEL_REPO",
    "BAE-HYUNWOO/scierc-relation-model",
)

HF_TOKEN = os.environ.get("HF_TOKEN")


def get_hf_model_dir(repo_id: str, local_name: str) -> Path:
    local_dir = MODEL_CACHE_DIR / local_name
    local_dir.mkdir(parents=True, exist_ok=True)

    snapshot_download(
        repo_id=repo_id,
        local_dir=str(local_dir),
        token=HF_TOKEN,
        local_dir_use_symlinks=False,
    )

    return local_dir


ENTITY_DIR = get_hf_model_dir(ENTITY_MODEL_REPO, "entity")
REL_DIR = get_hf_model_dir(RELATION_MODEL_REPO, "relation")

router = APIRouter(prefix="/api/ecosystem", tags=["Research Ecosystem Graph"])


SCIERC_PROJECT = Path(
    os.environ.get(
        "SCIERC_PROJECT_DIR",
        r"C:\Users\samsung-user\Desktop\scierc_pure_project",
    )
)

PURE = SCIERC_PROJECT / "external" / "PURE"

TMP = SCIERC_PROJECT / "outputs" / "ecosystem_graph"
UPLOAD_DIR = TMP / "uploads"
PURE_JSON = TMP / "pure_json"

for path in [TMP, UPLOAD_DIR, PURE_JSON]:
    path.mkdir(parents=True, exist_ok=True)


def sent_tokenize(text: str):
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s for s in sentences if s.strip()]


def word_tokenize(sent: str):
    return re.findall(r"[A-Za-z0-9]+|[^\sA-Za-z0-9]", sent)


def span_text(tokens, start, end):
    return " ".join(tokens[start:end + 1]).replace(" ##", "")


def clean_abstract(value: str) -> str:
    value = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def extract_abstracts_from_csv(path: Path) -> List[str]:
    df = pd.read_csv(path, encoding="utf-8-sig", low_memory=False)

    lower_map = {str(c).lower().strip(): c for c in df.columns}
    col = None

    for name in ["abstract", "summary", "description", "text"]:
        if name in lower_map:
            col = lower_map[name]
            break

    if col is None:
        # fallback: longest text-like column
        text_cols = [c for c in df.columns if df[c].dtype == object]
        if not text_cols:
            return []
        col = max(text_cols, key=lambda c: df[c].astype(str).str.len().mean())

    return [clean_abstract(x) for x in df[col].dropna().tolist() if clean_abstract(x)]


def extract_abstracts_from_json(path: Path) -> List[str]:
    text = path.read_text(encoding="utf-8-sig", errors="replace").strip()
    if not text:
        return []

    records = []
    if path.suffix.lower() == ".jsonl":
        for line in text.splitlines():
            line = line.strip()
            if line:
                records.append(json.loads(line))
    else:
        data = json.loads(text)
        if isinstance(data, list):
            records = data
        elif isinstance(data, dict):
            records = data.get("records") or data.get("papers") or data.get("data") or [data]

    abstracts = []
    for row in records:
        if isinstance(row, dict):
            value = row.get("abstract") or row.get("summary") or row.get("description") or row.get("text")
            value = clean_abstract(value)
            if value:
                abstracts.append(value)
    return abstracts


def extract_abstracts_from_txt(path: Path) -> List[str]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()

    if "\n---\n" in text:
        parts = re.split(r"\n\s*---\s*\n", text)
    else:
        parts = re.split(r"\n\s*\n", text)

    out = []
    for part in parts:
        part = re.sub(r"^(TITLE|ARXIV|URL|ABSTRACT):.*$", "", part, flags=re.MULTILINE)
        part = clean_abstract(part)
        if len(part.split()) >= 20:
            out.append(part)
    return out


def extract_abstracts(path: Path) -> List[str]:
    suffix = path.suffix.lower()

    if suffix == ".csv":
        return extract_abstracts_from_csv(path)
    if suffix in {".json", ".jsonl"}:
        return extract_abstracts_from_json(path)
    if suffix in {".txt", ".md"}:
        return extract_abstracts_from_txt(path)

    raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}")


def write_pure_json(abstracts: List[str]):
    docs = []

    for i, abstract in enumerate(abstracts, start=1):
        sentences = [word_tokenize(s) for s in sent_tokenize(abstract)]
        if not sentences:
            continue

        doc = {
            "doc_key": f"abstract_{i:06d}",
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
    env["PYTHONUNBUFFERED"] = "1"

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


def build_graph_response(top_entities: int, top_relations: int, min_support: int):
    pred_path = REL_DIR / "rel_pred_demo.json"
    if not pred_path.exists():
        raise HTTPException(status_code=500, detail="Relation prediction file was not created.")

    docs = [
        json.loads(line)
        for line in pred_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    entity_type = {}
    node_weight = Counter()
    edge_counter = defaultdict(lambda: {"count": 0, "docs": set()})

    for doc in docs:
        tokens = []
        for sent in doc["sentences"]:
            tokens.extend(sent)

        for sent_ner in doc.get("predicted_ner", []):
            for start, end, label in sent_ner:
                text = span_text(tokens, start, end)
                entity_type[text] = label
                node_weight[text] += 1

        for sent_rel in doc.get("predicted_relations", []):
            for s1, e1, s2, e2, rel in sent_rel:
                h = span_text(tokens, s1, e1)
                t = span_text(tokens, s2, e2)
                key = (h, rel, t)
                edge_counter[key]["count"] += 1
                edge_counter[key]["docs"].add(doc["doc_key"])
                node_weight[h] += 1
                node_weight[t] += 1

    top_node_set = {node for node, _ in node_weight.most_common(top_entities)}

    kept_edges = []
    for (h, rel, t), info in edge_counter.items():
        if info["count"] < min_support:
            continue
        if h not in top_node_set or t not in top_node_set:
            continue
        kept_edges.append((h, rel, t, info["count"], sorted(info["docs"])))

    kept_edges.sort(key=lambda x: x[3], reverse=True)
    kept_edges = kept_edges[:top_relations]

    color_by_type = {
        "Method": "#4C78A8",
        "Task": "#54A24B",
        "Material": "#F58518",
        "Metric": "#E45756",
        "Generic": "#B279A2",
        "OtherScientificTerm": "#72B7B2",
        "Entity": "#999999",
    }

    nodes = []
    edges = []
    added = set()
    triples = []

    for h, rel, t, support, docs_used in kept_edges:
        for node in [h, t]:
            if node not in added:
                etype = entity_type.get(node, "Entity")
                nodes.append(
                    {
                        "data": {
                            "id": node,
                            "label": node,
                            "type": etype,
                            "weight": node_weight[node],
                            "color": color_by_type.get(etype, "#999999"),
                        }
                    }
                )
                added.add(node)

        edges.append(
            {
                "data": {
                    "id": f"{h}__{rel}__{t}",
                    "source": h,
                    "target": t,
                    "label": rel,
                    "support": support,
                    "documents": docs_used[:20],
                }
            }
        )

        triples.append(
            {
                "entity1": h,
                "relation": rel,
                "entity2": t,
                "support": support,
                "documents": docs_used[:20],
            }
        )

    return {
        "success": True,
        "num_abstracts": len(docs),
        "num_nodes": len(nodes),
        "num_edges": len(edges),
        "nodes": nodes,
        "edges": edges,
        "triples": triples,
    }


@router.post("/build-from-file")
async def build_from_file(
    file: UploadFile = File(...),
    top_entities: int = Form(100),
    top_relations: int = Form(200),
    min_support: int = Form(2),
    max_abstracts: int = Form(1000),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file name.")

    suffix = Path(file.filename).suffix.lower()
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", file.filename)
    upload_path = UPLOAD_DIR / safe_name

    content = await file.read()
    upload_path.write_bytes(content)

    abstracts = extract_abstracts(upload_path)
    abstracts = [a for a in abstracts if a.strip()]

    if not abstracts:
        raise HTTPException(status_code=400, detail="No abstracts found in the uploaded file.")

    abstracts = abstracts[: int(max_abstracts)]

    n_docs = write_pure_json(abstracts)

    try:
        run_entity()
        run_relation()
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error))

    result = build_graph_response(
        top_entities=int(top_entities),
        top_relations=int(top_relations),
        min_support=int(min_support),
    )

    result["input_file"] = file.filename
    result["parsed_abstracts"] = len(abstracts)
    result["num_abstracts"] = n_docs
    return result
