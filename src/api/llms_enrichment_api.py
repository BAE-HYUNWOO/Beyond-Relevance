from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Dict, List, Optional
import csv
import json
import re
import time
import requests

router = APIRouter()

DATASET_PATH = Path(__file__).resolve().parents[1] / "data" / "dataset" / "papers_dataset.csv"

OUTPUT_COLUMNS = [
    "system", "query word", "query datetime", "rank", "dataset",
    "openalex id", "doi", "title", "year", "type", "source", "publisher",
    "authors", "institutions", "reference", "cited by", "fwci",
    "citation percentile (by year/subfield)", "primary topic",
    "primary subfield", "primary field", "primary domain",
    "is oa", "open access status",
]

class LlmEnrichRequest(BaseModel):
    query: str = ""
    runDate: str = ""
    runTime: str = ""
    llmConfig: Dict[str, str] = {}
    titles: List[str] = []

def normalize_title(value: str) -> str:
    return re.sub(r"\\s+", " ", re.sub(r"[^\\w\\s-]", " ", str(value or "").lower())).strip()

def similarity(a: str, b: str) -> float:
    a = normalize_title(a)
    b = normalize_title(b)
    if not a or not b:
        return 0
    if a == b:
        return 1
    sa = set(a.split())
    sb = set(b.split())
    return len(sa & sb) / max(1, max(len(sa), len(sb)))

def join_unique(values):
    seen = []
    for v in values or []:
        s = str(v or "").strip()
        if s and s not in seen:
            seen.append(s)
    return "; ".join(seen)

def read_dataset_rows():
    if not DATASET_PATH.exists():
        return []
    with DATASET_PATH.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))

def append_dataset_rows(rows):
    DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    exists = DATASET_PATH.exists()
    with DATASET_PATH.open("a", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS, extrasaction="ignore")
        if not exists:
            writer.writeheader()
        for row in rows:
            writer.writerow({col: row.get(col, "") for col in OUTPUT_COLUMNS})

def find_existing(title, rows):
    target = normalize_title(title)
    for row in rows:
        if normalize_title(row.get("title", "")) == target:
            return row
    return None

def openalex_match(title, api_key, rank, query):
    params = {
        "search": title,
        "per_page": 5,
        "select": "id,doi,title,display_name,type,cited_by_count,publication_year,authorships,primary_location,open_access,topics,fwci,citation_normalized_percentile,referenced_works_count",
    }
    if api_key:
        params["api_key"] = api_key
    res = requests.get("https://api.openalex.org/works", params=params, timeout=30)
    res.raise_for_status()
    results = res.json().get("results", [])

    best, best_score = None, 0
    for work in results:
        score = similarity(title, work.get("title") or work.get("display_name") or "")
        if score > best_score:
            best, best_score = work, score
    if not best or best_score < 0.82:
        return None

    source = (best.get("primary_location") or {}).get("source") or {}
    oa = best.get("open_access") or {}
    topics = best.get("topics") or []
    top_topic = sorted(topics, key=lambda x: x.get("score", 0), reverse=True)[0] if topics else {}
    cnp = best.get("citation_normalized_percentile") or {}

    return {
        "system": "LLMs", "query word": query,
        "query datetime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "rank": rank, "dataset": "OpenAlex",
        "openalex id": best.get("id", ""), "doi": best.get("doi", ""),
        "title": best.get("title") or best.get("display_name") or title,
        "year": best.get("publication_year", ""), "type": best.get("type", ""),
        "source": source.get("display_name", ""),
        "publisher": source.get("host_organization_name", ""),
        "authors": join_unique([(a.get("author") or {}).get("display_name") for a in best.get("authorships", [])]),
        "institutions": join_unique([i.get("display_name") for a in best.get("authorships", []) for i in a.get("institutions", [])]),
        "reference": best.get("referenced_works_count", ""),
        "cited by": best.get("cited_by_count", 0),
        "fwci": best.get("fwci", ""),
        "citation percentile (by year/subfield)": cnp.get("value", ""),
        "primary topic": top_topic.get("display_name", ""),
        "primary subfield": (top_topic.get("subfield") or {}).get("display_name", ""),
        "primary field": (top_topic.get("field") or {}).get("display_name", ""),
        "primary domain": (top_topic.get("domain") or {}).get("display_name", ""),
        "is oa": oa.get("is_oa", ""),
        "open access status": oa.get("oa_status", ""),
    }

def semantic_match(title, api_key, rank, query):
    headers = {"x-api-key": api_key} if api_key else {}
    params = {
        "query": title, "limit": 5,
        "fields": "paperId,title,year,authors,venue,citationCount,referenceCount,externalIds,publicationVenue,fieldsOfStudy,openAccessPdf",
    }
    res = requests.get("https://api.semanticscholar.org/graph/v1/paper/search", params=params, headers=headers, timeout=30)
    res.raise_for_status()
    results = res.json().get("data", [])
    best, best_score = None, 0
    for paper in results:
        score = similarity(title, paper.get("title", ""))
        if score > best_score:
            best, best_score = paper, score
    if not best or best_score < 0.82:
        return None
    external = best.get("externalIds") or {}
    venue = best.get("publicationVenue") or {}
    return {
        "system": "LLMs", "query word": query,
        "query datetime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "rank": rank, "dataset": "Semantic Scholar",
        "openalex id": "", "doi": f"https://doi.org/{external.get('DOI')}" if external.get("DOI") else "",
        "title": best.get("title") or title,
        "year": best.get("year", ""), "type": "",
        "source": venue.get("name") or best.get("venue", ""),
        "publisher": venue.get("publisher", ""),
        "authors": join_unique([a.get("name") for a in best.get("authors", [])]),
        "institutions": "", "reference": best.get("referenceCount", ""),
        "cited by": best.get("citationCount", 0), "fwci": "",
        "citation percentile (by year/subfield)": "",
        "primary topic": join_unique(best.get("fieldsOfStudy", [])),
        "primary subfield": "", "primary field": "", "primary domain": "",
        "is oa": bool(best.get("openAccessPdf")) if best.get("openAccessPdf") else "",
        "open access status": "open" if best.get("openAccessPdf") else "",
    }

def crossref_match(title, rank, query):
    res = requests.get("https://api.crossref.org/works", params={"query.title": title, "rows": 5}, timeout=30)
    res.raise_for_status()
    items = (res.json().get("message") or {}).get("items", [])
    best, best_score = None, 0
    for item in items:
        candidate = (item.get("title") or [""])[0]
        score = similarity(title, candidate)
        if score > best_score:
            best, best_score = item, score
    if not best or best_score < 0.78:
        return None

    year = ""
    for key in ["published-print", "published-online", "published", "issued"]:
        try:
            year = best.get(key, {}).get("date-parts", [[None]])[0][0] or ""
            if year:
                break
        except Exception:
            pass

    return {
        "system": "LLMs", "query word": query,
        "query datetime": time.strftime("%Y-%m-%d %H:%M:%S"),
        "rank": rank, "dataset": "Crossref",
        "openalex id": "", "doi": f"https://doi.org/{best.get('DOI')}" if best.get("DOI") else "",
        "title": (best.get("title") or [title])[0],
        "year": year, "type": best.get("type", ""),
        "source": (best.get("container-title") or [""])[0],
        "publisher": best.get("publisher", ""),
        "authors": join_unique([f"{a.get('given', '')} {a.get('family', '')}".strip() for a in best.get("author", [])]),
        "institutions": "", "reference": best.get("references-count", ""),
        "cited by": best.get("is-referenced-by-count", 0),
        "fwci": "", "citation percentile (by year/subfield)": "",
        "primary topic": "", "primary subfield": "", "primary field": "", "primary domain": "",
        "is oa": "", "open access status": "",
    }

@router.post("/api/llms/run-enriched")
def run_llms_enriched(req: LlmEnrichRequest):
    def stream():
        titles = list(dict.fromkeys([t.strip() for t in req.titles if t.strip()]))
        if not titles:
            yield "No titles provided to enrichment step.\\n"
            return

        dataset_rows = read_dataset_rows()
        found, not_found, to_append = [], [], []

        yield f"ENRICHMENT STARTED: {len(titles)} title(s)\\n"
        yield f"Dataset cache: {DATASET_PATH}\\n\\n"

        for idx, title in enumerate(titles, 1):
            yield f"[{idx}/{len(titles)}] {title}\\n"

            existing = find_existing(title, dataset_rows)
            if existing:
                row = dict(existing)
                row["system"] = "LLMs"
                row["query word"] = req.query
                row["rank"] = idx
                found.append(row)
                yield "  FOUND in papers_dataset.csv\\n\\n"
                continue

            row = None
            for name, fn in [
                ("OpenAlex", lambda: openalex_match(title, req.llmConfig.get("OPENALEX_API_KEY", ""), idx, req.query)),
                ("Semantic Scholar", lambda: semantic_match(title, req.llmConfig.get("SEMANTIC_API_KEY", ""), idx, req.query)),
                ("Crossref", lambda: crossref_match(title, idx, req.query)),
            ]:
                try:
                    row = fn()
                    if row:
                        yield f"  MATCHED by {name}\\n"
                        break
                except Exception as e:
                    yield f"  {name} failed: {e}\\n"

            if row:
                found.append(row)
                to_append.append(row)
                dataset_rows.append(row)
            else:
                not_found.append(title)
                yield "  NOT FOUND\\n"
            yield "\\n"

        if to_append:
            append_dataset_rows(to_append)
            yield f"APPENDED to papers_dataset.csv: {len(to_append)} row(s)\\n"

        out_dir = DATASET_PATH.parent / "llms_generated"
        out_dir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        matched_path = out_dir / f"llms_matched_{ts}.csv"
        not_found_path = out_dir / f"llms_not_found_{ts}.txt"

        with matched_path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS, extrasaction="ignore")
            writer.writeheader()
            for row in found:
                writer.writerow({col: row.get(col, "") for col in OUTPUT_COLUMNS})

        not_found_path.write_text("\\n".join(not_found), encoding="utf-8")

        rel_matched = str(matched_path.relative_to(DATASET_PATH.parents[1])).replace("\\\\", "/")
        rel_not_found = str(not_found_path.relative_to(DATASET_PATH.parents[1])).replace("\\\\", "/")

        yield "\\nDONE\\n"
        yield f"GENERATED_FILE={rel_matched}\\n"
        yield f"GENERATED_FILE={rel_not_found}\\n"
        yield f"MATCHED={len(found)} NOT_FOUND={len(not_found)}\\n"

    return StreamingResponse(stream(), media_type="text/plain")
