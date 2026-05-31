from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from difflib import SequenceMatcher
from datetime import datetime
import csv
import io
import json
import re
import time
import requests
import pandas as pd

router = APIRouter()

MAILTO = "bhwbhw0307@gmail.com"
DATASET_FILE = Path(__file__).resolve().parents[1] / "data" / "dataset" / "papers_dataset.csv"

OPENALEX_BASE = "https://api.openalex.org/works"
SEMANTIC_SEARCH_BASE = "https://api.semanticscholar.org/graph/v1/paper/search"
CROSSREF_BASE = "https://api.crossref.org/works"

OPENALEX_SIM_THRESHOLD = 0.92
SEMANTIC_SIM_THRESHOLD = 0.92
CROSSREF_SIM_THRESHOLD = 0.90

OUTPUT_COLUMNS = [
    "system", "query word", "query datetime", "rank", "dataset", "openalex id", "doi",
    "title", "year", "type", "source", "publisher", "authors", "institutions", "reference",
    "cited by", "fwci", "citation percentile (by year/subfield)", "primary topic",
    "primary subfield", "primary field", "primary domain", "is oa", "open access status"
]

DATASET_COLUMNS = [c for c in OUTPUT_COLUMNS if c not in ["system", "query word", "query datetime", "rank"]]

OPENALEX_SELECT_FIELDS = [
    "id", "doi", "title", "display_name", "type", "cited_by_count", "publication_year",
    "authorships", "primary_location", "open_access", "topics", "fwci",
    "citation_normalized_percentile", "referenced_works_count"
]

SEMANTIC_FIELDS = [
    "paperId", "title", "year", "authors", "venue", "citationCount", "referenceCount",
    "externalIds", "publicationVenue", "fieldsOfStudy", "openAccessPdf"
]

class MatchTitlesRequest(BaseModel):
    titles: list[str]
    queryWord: str | None = ""
    openAlexApiKey: str | None = ""
    semanticApiKey: str | None = ""


def normalize_title(title: str) -> str:
    title = str(title or "").lower().strip().replace("–", "-").replace("—", "-")
    title = re.sub(r"[^\w\s-]", " ", title)
    title = re.sub(r"\s+", " ", title)
    return title.strip()


def similar(a: str, b: str) -> float:
    a, b = normalize_title(a), normalize_title(b)
    if not a or not b:
        return 0
    return SequenceMatcher(None, a, b).ratio()


def clean_doi(value: str) -> str:
    raw = str(value or "").strip()
    raw = re.sub(r"^https?://(dx\.)?doi\.org/", "", raw, flags=re.I)
    match = re.search(r"10\.\d{4,9}/\S+", raw)
    return match.group(0).rstrip(".,;") if match else ""


def dedup_join(items) -> str:
    out = []
    for item in items or []:
        value = str(item or "").strip()
        if value and value not in out:
            out.append(value)
    return "; ".join(out)


def align_row(row: dict, columns: list[str]) -> dict:
    return {col: row.get(col, "") for col in columns}


def output_from_dataset_row(row: dict, rank: int, query_word: str) -> dict:
    out = {col: row.get(col, "") for col in DATASET_COLUMNS}
    out.update({
        "system": "Titles Input",
        "query word": query_word or "",
        "query datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "rank": rank,
        "dataset": row.get("dataset") or "ExistingDataset",
    })
    return align_row(out, OUTPUT_COLUMNS)


def build_openalex_row(work: dict, title: str, rank: int, query_word: str) -> dict:
    open_access = work.get("open_access") or {}
    source = (work.get("primary_location") or {}).get("source") or {}
    topics = work.get("topics") or []
    top_topic = max(topics, key=lambda x: x.get("score", -1)) if topics else {}
    cnp = work.get("citation_normalized_percentile") or {}
    return align_row({
        "system": "Titles Input",
        "query word": query_word or "",
        "query datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "rank": rank,
        "dataset": "OpenAlex",
        "openalex id": work.get("id"),
        "doi": work.get("doi"),
        "title": work.get("title") or work.get("display_name") or title,
        "year": work.get("publication_year"),
        "type": work.get("type"),
        "source": source.get("display_name"),
        "publisher": source.get("host_organization_name"),
        "authors": dedup_join([(a.get("author") or {}).get("display_name") for a in work.get("authorships", [])]),
        "institutions": dedup_join([i.get("display_name") for a in work.get("authorships", []) for i in a.get("institutions", [])]),
        "reference": work.get("referenced_works_count"),
        "cited by": work.get("cited_by_count"),
        "fwci": work.get("fwci"),
        "citation percentile (by year/subfield)": cnp.get("value"),
        "primary topic": top_topic.get("display_name"),
        "primary subfield": (top_topic.get("subfield") or {}).get("display_name"),
        "primary field": (top_topic.get("field") or {}).get("display_name"),
        "primary domain": (top_topic.get("domain") or {}).get("display_name"),
        "is oa": open_access.get("is_oa"),
        "open access status": open_access.get("oa_status"),
    }, OUTPUT_COLUMNS)


def build_semantic_row(paper: dict, title: str, rank: int, query_word: str) -> dict:
    external_ids = paper.get("externalIds") or {}
    doi = external_ids.get("DOI") or ""
    if doi and not str(doi).lower().startswith("http"):
        doi = f"https://doi.org/{doi}"
    venue = paper.get("publicationVenue") or {}
    return align_row({
        "system": "Titles Input",
        "query word": query_word or "",
        "query datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "rank": rank,
        "dataset": "Semantic Scholar",
        "doi": doi,
        "title": paper.get("title") or title,
        "year": paper.get("year"),
        "source": venue.get("name") or paper.get("venue"),
        "publisher": venue.get("publisher"),
        "authors": dedup_join([a.get("name") for a in paper.get("authors", [])]),
        "reference": paper.get("referenceCount"),
        "cited by": paper.get("citationCount"),
        "primary topic": dedup_join(paper.get("fieldsOfStudy") or []),
        "is oa": True if paper.get("openAccessPdf") else "",
        "open access status": "open" if paper.get("openAccessPdf") else "",
    }, OUTPUT_COLUMNS)


def build_crossref_row(item: dict, title: str, rank: int, query_word: str) -> dict:
    year = ""
    for key in ["published-print", "published-online", "published"]:
        try:
            year = item.get(key, {}).get("date-parts", [[""]])[0][0]
            if year:
                break
        except Exception:
            pass
    authors = []
    for author in item.get("author", []) or []:
        name = " ".join([str(author.get("given", "")).strip(), str(author.get("family", "")).strip()]).strip()
        if name:
            authors.append(name)
    doi = item.get("DOI") or ""
    if doi:
        doi = f"https://doi.org/{doi}"
    return align_row({
        "system": "Titles Input",
        "query word": query_word or "",
        "query datetime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "rank": rank,
        "dataset": "Crossref",
        "doi": doi,
        "title": item.get("title", [title])[0] if item.get("title") else title,
        "year": year,
        "type": item.get("type"),
        "source": item.get("container-title", [""])[0] if item.get("container-title") else "",
        "publisher": item.get("publisher"),
        "authors": dedup_join(authors),
        "reference": item.get("references-count"),
        "cited by": item.get("is-referenced-by-count"),
    }, OUTPUT_COLUMNS)


def load_dataset_lookup() -> dict:
    DATASET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not DATASET_FILE.exists():
        pd.DataFrame(columns=DATASET_COLUMNS).to_csv(DATASET_FILE, index=False, encoding="utf-8-sig")
        return {}
    df = pd.read_csv(DATASET_FILE, encoding="utf-8-sig").fillna("")
    lookup = {}
    if "title" in df.columns:
        for _, row in df.iterrows():
            key = normalize_title(row.get("title", ""))
            if key and key not in lookup:
                lookup[key] = row.to_dict()
    return lookup


def append_dataset_row(row: dict):
    DATASET_FILE.parent.mkdir(parents=True, exist_ok=True)
    dataset_row = align_row(row, DATASET_COLUMNS)
    if DATASET_FILE.exists():
        df = pd.read_csv(DATASET_FILE, encoding="utf-8-sig").fillna("")
    else:
        df = pd.DataFrame(columns=DATASET_COLUMNS)
    if "title" in df.columns:
        existing = {normalize_title(x) for x in df["title"].tolist()}
        if normalize_title(dataset_row.get("title")) in existing:
            return
    df = pd.concat([df, pd.DataFrame([dataset_row])], ignore_index=True)
    df = df.drop_duplicates(subset=["title"], keep="first") if "title" in df.columns else df
    df.to_csv(DATASET_FILE, index=False, encoding="utf-8-sig")


def request_json(session, url, *, params=None, headers=None):
    for attempt in range(3):
        response = session.get(url, params=params, headers=headers, timeout=30)
        if response.status_code == 429:
            time.sleep(int(response.headers.get("Retry-After", "5")))
            continue
        if response.status_code >= 500:
            time.sleep(2 ** attempt)
            continue
        response.raise_for_status()
        return response.json()
    return None


def search_openalex(session, title: str, api_key: str | None):
    params = {"search": title, "per_page": 5, "mailto": MAILTO, "select": ",".join(OPENALEX_SELECT_FIELDS)}
    if api_key:
        params["api_key"] = api_key
    data = request_json(session, OPENALEX_BASE, params=params)
    if not data:
        return None
    best, score = None, 0
    for work in data.get("results", []):
        candidate = work.get("display_name") or work.get("title") or ""
        if normalize_title(candidate) == normalize_title(title):
            return work
        s = similar(title, candidate)
        if s > score:
            best, score = work, s
    return best if best and score >= OPENALEX_SIM_THRESHOLD else None


def search_semantic(session, title: str, api_key: str | None):
    headers = {"x-api-key": api_key} if api_key else None
    params = {"query": title, "limit": 5, "fields": ",".join(SEMANTIC_FIELDS)}
    data = request_json(session, SEMANTIC_SEARCH_BASE, params=params, headers=headers)
    if not data:
        return None
    best, score = None, 0
    for paper in data.get("data", []):
        candidate = paper.get("title") or ""
        if normalize_title(candidate) == normalize_title(title):
            return paper
        s = similar(title, candidate)
        if s > score:
            best, score = paper, s
    return best if best and score >= SEMANTIC_SIM_THRESHOLD else None


def search_crossref(session, title: str):
    params = {"query.title": title, "rows": 5, "mailto": MAILTO}
    data = request_json(session, CROSSREF_BASE, params=params)
    if not data:
        return None
    best, score = None, 0
    for item in data.get("message", {}).get("items", []):
        candidate = item.get("title", [""])[0] if item.get("title") else ""
        if normalize_title(candidate) == normalize_title(title):
            return item
        s = similar(title, candidate)
        if s > score:
            best, score = item, s
    return best if best and score >= CROSSREF_SIM_THRESHOLD else None


def stream_event(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


@router.post("/api/benchmark/match-titles")
def match_titles(req: MatchTitlesRequest):
    def generate():
        titles = []
        seen = set()
        for title in req.titles:
            cleaned = str(title or "").strip()
            key = normalize_title(cleaned)
            if cleaned and key not in seen:
                seen.add(key)
                titles.append(cleaned)

        lookup = load_dataset_lookup()
        matched = 0
        not_found = 0
        total = len(titles)

        with requests.Session() as session:
            session.headers.update({"User-Agent": f"BenchmarkTitleMatcher ({MAILTO})"})

            for idx, title in enumerate(titles, start=1):
                key = normalize_title(title)
                yield stream_event({"type": "progress", "index": idx, "total": total, "message": f"{idx}/{total} checking local papers_dataset.csv: {title}"})

                if key in lookup:
                    row = output_from_dataset_row(lookup[key], idx, req.queryWord or "")
                    matched += 1
                    yield stream_event({"type": "found", "source": "papers_dataset.csv", "index": idx, "total": total, "row": row})
                    continue

                row = None
                yield stream_event({"type": "progress", "index": idx, "total": total, "message": f"{idx}/{total} searching OpenAlex: {title}"})
                work = search_openalex(session, title, req.openAlexApiKey)
                if work:
                    row = build_openalex_row(work, title, idx, req.queryWord or "")

                if not row:
                    yield stream_event({"type": "progress", "index": idx, "total": total, "message": f"{idx}/{total} searching Semantic Scholar: {title}"})
                    paper = search_semantic(session, title, req.semanticApiKey)
                    if paper:
                        row = build_semantic_row(paper, title, idx, req.queryWord or "")

                if not row:
                    yield stream_event({"type": "progress", "index": idx, "total": total, "message": f"{idx}/{total} searching Crossref: {title}"})
                    item = search_crossref(session, title)
                    if item:
                        row = build_crossref_row(item, title, idx, req.queryWord or "")

                if row:
                    append_dataset_row(row)
                    lookup[normalize_title(row.get("title") or title)] = row
                    matched += 1
                    yield stream_event({"type": "found", "source": row.get("dataset"), "index": idx, "total": total, "row": row})
                else:
                    not_found += 1
                    yield stream_event({"type": "not_found", "index": idx, "total": total, "title": title})

        yield stream_event({"type": "done", "matched": matched, "notFound": not_found})

    return StreamingResponse(generate(), media_type="application/x-ndjson")
