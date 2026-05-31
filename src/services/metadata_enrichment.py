# ========================================================================================================
# input
# ========================================================================================================
# RUN_METADATA_ENRICHMENT_FOR_IR = True
# RUN_METADATA_ENRICHMENT_FOR_LLM = True
# SKIP_EXISTING_ENRICHED_FILES = True
#
# USE_OPENALEX_METADATA = True
# USE_SEMANTIC_SCHOLAR_METADATA = True
# USE_CROSSREF_METADATA = True
#
# OPENALEX_API_KEY = "..."
# OPENALEX_MAILTO = "example@gmail.com"
# SEMANTIC_SCHOLAR_API_KEY = "..."
# CROSSREF_MAILTO = OPENALEX_MAILTO
#
# fixed input directories:
# data/raw/ir_outputs/original_titles/
# data/raw/llm_outputs/

# ========================================================================================================
# output
# ========================================================================================================
# data/processed/systems_distribution/
# ├── Google Scholar_Econometrics_20260523_enriched.csv
# ├── Scopus_Econometrics_20260523_enriched.csv
# ├── GPT_Econometrics_20260523_enriched.csv
# └── ...
#
# enriched.csv columns:
# original input columns +
# openalex id, doi, title, year, type, source, publisher
# authors, institutions, reference, cited by, fwci
# citation percentile (by year/subfield)
# primary topic, primary subfield, primary field, primary domain
# is oa, open access status
# match source, match status

# ========================================================================================================
# matching logic
# ========================================================================================================
# DOI match:
# OpenAlex → Semantic Scholar → Crossref
#
# title match:
# OpenAlex → Semantic Scholar → Crossref
#
# match status:
# found / not found

# ========================================================================================================
# run
# ========================================================================================================
# python scripts/run_metadata_enrichment.py

import re
import time
import requests
import pandas as pd
from pathlib import Path
from difflib import SequenceMatcher
from src.config.settings import (
    OPENALEX_API_KEY,
    OPENALEX_MAILTO,
    SEMANTIC_SCHOLAR_API_KEY,
    CROSSREF_MAILTO,
    RUN_METADATA_ENRICHMENT_FOR_IR,
    RUN_METADATA_ENRICHMENT_FOR_LLM,
    SKIP_EXISTING_ENRICHED_FILES,
    USE_OPENALEX_METADATA,
    USE_SEMANTIC_SCHOLAR_METADATA,
    USE_CROSSREF_METADATA,
)
OPENALEX_BASE_URL = "https://api.openalex.org/works"
FINAL_COLUMNS = [
    "query word", "dataset", "openalex id", "doi", "title", "year", "type",
    "source", "publisher", "authors", "institutions", "reference", "cited by",
    "fwci", "citation percentile (by year/subfield)", "primary topic",
    "primary subfield", "primary field", "primary domain", "is oa",
    "open access status", "language", "country_code",
]
IR_OUTPUT_DIR = Path("data/raw/ir_outputs/original_titles")
LLM_OUTPUT_DIR = Path("data/raw/llm_outputs")
METADATA_ENRICHED_OUTPUT_DIR = Path("data/processed/systems_distribution")
OPENALEX_SELECT_FIELDS = [
    "id",
    "doi",
    "title",
    "display_name",
    "type",
    "cited_by_count",
    "publication_year",
    "authorships",
    "primary_location",
    "open_access",
    "topics",
    "fwci",
    "citation_normalized_percentile",
    "referenced_works_count",
    "language",
]
TITLE_MATCH_THRESHOLD = 0.88
REQUEST_SLEEP = 0.3
MAX_RETRIES = 3

SEMANTIC_BASE_URL = "https://api.semanticscholar.org/graph/v1/paper"
CROSSREF_BASE_URL = "https://api.crossref.org/works"

SEMANTIC_SELECT_FIELDS = [
    "paperId", "title", "year", "authors", "venue", "citationCount",
    "referenceCount", "externalIds", "publicationVenue", "fieldsOfStudy", "openAccessPdf"
]

SEMANTIC_TITLE_MATCH_THRESHOLD = 0.88
CROSSREF_TITLE_MATCH_THRESHOLD = 0.86
# ========================================================================================================
# metadata cache
# ========================================================================================================

METADATA_CACHE_FILE = Path("data/processed/systems_distribution/metadata_cache.csv")
SAVE_CACHE_EVERY = 20

def output_path_for_enriched_file(input_file):
    input_file = Path(input_file)
    METADATA_ENRICHED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return METADATA_ENRICHED_OUTPUT_DIR / f"{input_file.stem}_enriched.csv"
def load_metadata_cache():
    if not METADATA_CACHE_FILE.exists():
        return {}, pd.DataFrame()

    df = pd.read_csv(METADATA_CACHE_FILE, encoding="utf-8-sig")
    cache = {}

    for _, row in df.iterrows():
        doi_key = clean_doi(row.get("doi"))
        title_key = normalize_title(row.get("title"))

        if doi_key:
            cache[f"doi::{doi_key}"] = row.to_dict()

        if title_key:
            cache[f"title::{title_key}"] = row.to_dict()

    return cache, df


def save_metadata_cache(cache_rows):
    if not cache_rows:
        return

    METADATA_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)

    new_df = pd.DataFrame(cache_rows)

    if METADATA_CACHE_FILE.exists():
        old_df = pd.read_csv(METADATA_CACHE_FILE, encoding="utf-8-sig")
        df = pd.concat([old_df, new_df], ignore_index=True)
    else:
        df = new_df

    if "doi" in df.columns:
        df["_doi_key"] = df["doi"].map(clean_doi)
    else:
        df["_doi_key"] = ""

    if "title" in df.columns:
        df["_title_key"] = df["title"].map(normalize_title)
    else:
        df["_title_key"] = ""

    df = df.drop_duplicates(
        subset=["_doi_key", "_title_key"],
        keep="first",
    )

    df = df.drop(columns=["_doi_key", "_title_key"], errors="ignore")

    df.to_csv(METADATA_CACHE_FILE, index=False, encoding="utf-8-sig")

    print(f"[CACHE SAVED] {METADATA_CACHE_FILE} | rows={len(df)}")


def find_metadata_in_cache(title=None, doi=None, cache=None):
    if cache is None:
        return None

    doi_key = clean_doi(doi)
    title_key = normalize_title(title)

    if doi_key and f"doi::{doi_key}" in cache:
        result = cache[f"doi::{doi_key}"].copy()
        result["match source"] = "metadata cache DOI"
        return result

    if title_key and f"title::{title_key}" in cache:
        result = cache[f"title::{title_key}"].copy()
        result["match source"] = "metadata cache title"
        return result

    return None

def semantic_headers():
    return {"x-api-key": SEMANTIC_SCHOLAR_API_KEY} if SEMANTIC_SCHOLAR_API_KEY else {}


def search_semantic_by_doi(doi):
    doi = clean_doi(doi)
    if not doi:
        return None

    url = f"{SEMANTIC_BASE_URL}/DOI:{doi}"
    params = {"fields": ",".join(SEMANTIC_SELECT_FIELDS)}
    return request_with_retry(url, params=params, headers=semantic_headers())


def search_semantic_by_title(title):
    if not title:
        return None

    url = f"{SEMANTIC_BASE_URL}/search"
    params = {"query": title, "limit": 10, "fields": ",".join(SEMANTIC_SELECT_FIELDS)}
    data = request_with_retry(url, params=params, headers=semantic_headers())

    if not data:
        return None

    best_paper = None
    best_score = 0

    for paper in data.get("data", []):
        candidate_title = paper.get("title") or ""
        score = title_similarity(title, candidate_title)

        if normalize_title(title) == normalize_title(candidate_title):
            return paper

        if score > best_score:
            best_paper = paper
            best_score = score

    return best_paper if best_score >= SEMANTIC_TITLE_MATCH_THRESHOLD else None


def search_crossref_by_doi(doi):
    doi = clean_doi(doi)
    if not doi:
        return None

    params = {}
    if CROSSREF_MAILTO:
        params["mailto"] = CROSSREF_MAILTO

    data = request_with_retry(f"{CROSSREF_BASE_URL}/{doi}", params=params)
    return data.get("message") if data else None


def search_crossref_by_title(title):
    if not title:
        return None

    params = {"query.title": title, "rows": 10}
    if CROSSREF_MAILTO:
        params["mailto"] = CROSSREF_MAILTO

    data = request_with_retry(CROSSREF_BASE_URL, params=params)

    if not data:
        return None

    best_item = None
    best_score = 0

    for item in data.get("message", {}).get("items", []):
        candidate_title = item.get("title", [""])[0] if item.get("title") else ""
        score = title_similarity(title, candidate_title)

        if normalize_title(title) == normalize_title(candidate_title):
            return item

        if score > best_score:
            best_item = item
            best_score = score

    return best_item if best_score >= CROSSREF_TITLE_MATCH_THRESHOLD else None


def extract_semantic_metadata(paper):
    external_ids = paper.get("externalIds") or {}
    publication_venue = paper.get("publicationVenue") or {}
    doi = external_ids.get("DOI")

    return {
        "openalex id": None,
        "doi": f"https://doi.org/{doi}" if doi else None,
        "title": paper.get("title"),
        "year": paper.get("year"),
        "type": None,
        "source": publication_venue.get("name") or paper.get("venue"),
        "publisher": publication_venue.get("publisher"),
        "authors": dedup_join([a.get("name") for a in paper.get("authors", [])]),
        "institutions": None,
        "reference": paper.get("referenceCount"),
        "cited by": paper.get("citationCount"),
        "fwci": None,
        "citation percentile (by year/subfield)": None,
        "primary topic": dedup_join(paper.get("fieldsOfStudy") or []),
        "primary subfield": None,
        "primary field": None,
        "primary domain": None,
        "is oa": True if paper.get("openAccessPdf") else None,
        "open access status": "open" if paper.get("openAccessPdf") else None,
    }
def clean_doi(value):
    if value is None:
        return ""

    value = str(value).strip()
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value, flags=re.I)

    match = re.search(r"10\.\d{4,9}/[^\s\"'<>()]+", value)
    if not match:
        return ""

    doi = match.group(0)
    doi = re.sub(r"[)\]\}]+$", "", doi)
    doi = doi.rstrip(".,;")

    return doi


def normalize_title(title):
    title = str(title).lower().strip()
    title = title.replace("–", "-").replace("—", "-")
    title = re.sub(r"[^\w\s-]", " ", title)
    title = re.sub(r"\s+", " ", title)
    return title.strip()


def title_similarity(a, b):
    return SequenceMatcher(None, normalize_title(a), normalize_title(b)).ratio()


def dedup_join(items):
    output = []

    for item in items:
        if item is None:
            continue

        item = str(item).strip()

        if item and item not in output:
            output.append(item)

    return "; ".join(output) if output else None




def request_with_retry(url, params=None, headers=None):
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(
                url,
                params=params,
                headers=headers,
                timeout=30,
            )

            if response.status_code == 404:
                return None

            if response.status_code == 429:
                wait_time = int(response.headers.get("Retry-After", 30))
                print(f"[429] Rate limited. Waiting {wait_time}s...")
                time.sleep(wait_time)
                continue

            if 500 <= response.status_code < 600:
                wait_time = min(2**attempt * 5, 60)
                print(f"[SERVER ERROR] Waiting {wait_time}s...")
                time.sleep(wait_time)
                continue

            response.raise_for_status()
            return response.json()

        except requests.exceptions.RequestException as error:
            wait_time = min(2**attempt * 5, 60)
            print(f"[REQUEST ERROR] {error} | Waiting {wait_time}s...")
            time.sleep(wait_time)

    return None


def parse_system_file_name(input_file):
    stem = Path(input_file).stem

    if stem.endswith(".temp"):
        stem = stem.replace(".temp", "")

    parts = stem.split("_")

    if len(parts) < 3:
        return {
            "dataset": parts[0],
            "query word": None,
            "date_tag": None,
        }

    dataset = parts[0]
    date_tag = parts[-1]
    query_word = "_".join(parts[1:-1])

    return {
        "dataset": dataset,
        "query word": query_word,
        "date_tag": date_tag,
    }


def extract_openalex_metadata(work):
    if not work:
        return None

    open_access = work.get("open_access") or {}
    citation_percentile = work.get("citation_normalized_percentile") or {}
    primary_location = work.get("primary_location") or {}
    source = primary_location.get("source") or {}

    topics = work.get("topics") or []
    primary_topic = max(topics, key=lambda x: x.get("score", -1)) if topics else {}

    authors = dedup_join([
        authorship.get("author", {}).get("display_name")
        for authorship in work.get("authorships", [])
        if authorship.get("author", {}).get("display_name")
    ])

    institutions = dedup_join([
        institution.get("display_name")
        for authorship in work.get("authorships", [])
        for institution in authorship.get("institutions", [])
        if institution.get("display_name")
    ])

    country_codes = dedup_join([
        institution.get("country_code")
        for authorship in work.get("authorships", [])
        for institution in authorship.get("institutions", [])
        if institution.get("country_code")
    ])

    return {
        "openalex id": work.get("id"),
        "doi": work.get("doi"),
        "title": work.get("title") or work.get("display_name"),
        "year": work.get("publication_year"),
        "type": work.get("type"),
        "source": source.get("display_name"),
        "publisher": source.get("host_organization_name"),
        "authors": authors,
        "institutions": institutions,
        "reference": work.get("referenced_works_count"),
        "cited by": work.get("cited_by_count"),
        "fwci": work.get("fwci"),
        "citation percentile (by year/subfield)": citation_percentile.get("value"),
        "primary topic": primary_topic.get("display_name"),
        "primary subfield": (primary_topic.get("subfield") or {}).get("display_name"),
        "primary field": (primary_topic.get("field") or {}).get("display_name"),
        "primary domain": (primary_topic.get("domain") or {}).get("display_name"),
        "is oa": open_access.get("is_oa"),
        "open access status": open_access.get("oa_status"),
        "language": work.get("language"),
        "country_code": country_codes,
    }


def extract_semantic_metadata(paper):
    external_ids = paper.get("externalIds") or {}
    publication_venue = paper.get("publicationVenue") or {}
    doi = external_ids.get("DOI")

    return {
        "openalex id": None,
        "doi": f"https://doi.org/{doi}" if doi else None,
        "title": paper.get("title"),
        "year": paper.get("year"),
        "type": None,
        "source": publication_venue.get("name") or paper.get("venue"),
        "publisher": publication_venue.get("publisher"),
        "authors": dedup_join([a.get("name") for a in paper.get("authors", [])]),
        "institutions": None,
        "reference": paper.get("referenceCount"),
        "cited by": paper.get("citationCount"),
        "fwci": None,
        "citation percentile (by year/subfield)": None,
        "primary topic": dedup_join(paper.get("fieldsOfStudy") or []),
        "primary subfield": None,
        "primary field": None,
        "primary domain": None,
        "is oa": True if paper.get("openAccessPdf") else None,
        "open access status": "open" if paper.get("openAccessPdf") else None,
        "language": None,
        "country_code": None,
    }


def extract_crossref_metadata(item):
    year = None

    for key in ["published-print", "published-online", "published"]:
        try:
            year = item.get(key, {}).get("date-parts", [[None]])[0][0]
            if year:
                break
        except Exception:
            pass

    authors = []
    for author in item.get("author", []):
        name = f"{author.get('given', '')} {author.get('family', '')}".strip()
        if name:
            authors.append(name)

    doi = item.get("DOI")

    return {
        "openalex id": None,
        "doi": f"https://doi.org/{doi}" if doi else None,
        "title": item.get("title", [None])[0] if item.get("title") else None,
        "year": year,
        "type": item.get("type"),
        "source": item.get("container-title", [None])[0] if item.get("container-title") else None,
        "publisher": item.get("publisher"),
        "authors": dedup_join(authors),
        "institutions": None,
        "reference": item.get("references-count"),
        "cited by": item.get("is-referenced-by-count"),
        "fwci": None,
        "citation percentile (by year/subfield)": None,
        "primary topic": None,
        "primary subfield": None,
        "primary field": None,
        "primary domain": None,
        "is oa": None,
        "open access status": None,
        "language": None,
        "country_code": None,
    }
def search_openalex_by_doi(doi, mailto=None, api_key=None):
    doi = clean_doi(doi)

    if not doi:
        return None

    params = {
        "select": ",".join(OPENALEX_SELECT_FIELDS),
    }

    if mailto:
        params["mailto"] = mailto

    if api_key:
        params["api_key"] = api_key

    url = f"{OPENALEX_BASE_URL}/doi:{doi}"

    return request_with_retry(url, params=params)


def search_openalex_by_title(title, mailto=None, api_key=None):
    if not title:
        return None

    params = {
        "search": title,
        "per_page": 10,
        "select": ",".join(OPENALEX_SELECT_FIELDS),
    }

    if mailto:
        params["mailto"] = mailto

    if api_key:
        params["api_key"] = api_key

    data = request_with_retry(OPENALEX_BASE_URL, params=params)

    if not data:
        return None

    best_work = None
    best_score = 0

    for work in data.get("results", []):
        candidate_title = work.get("display_name") or work.get("title") or ""
        score = title_similarity(title, candidate_title)

        if normalize_title(title) == normalize_title(candidate_title):
            return work

        if score > best_score:
            best_work = work
            best_score = score

    if best_score >= TITLE_MATCH_THRESHOLD:
        return best_work

    return None
def match_single_paper(title=None, doi=None):
    doi = clean_doi(doi)

    if doi:
        if USE_OPENALEX_METADATA:
            work = search_openalex_by_doi(
                doi,
                mailto=OPENALEX_MAILTO,
                api_key=OPENALEX_API_KEY,
            )
            if work:
                return extract_openalex_metadata(work)

        if USE_SEMANTIC_SCHOLAR_METADATA:
            paper = search_semantic_by_doi(doi)
            if paper:
                return extract_semantic_metadata(paper)

        if USE_CROSSREF_METADATA:
            item = search_crossref_by_doi(doi)
            if item:
                return extract_crossref_metadata(item)

    if title:
        if USE_OPENALEX_METADATA:
            work = search_openalex_by_title(
                title,
                mailto=OPENALEX_MAILTO,
                api_key=OPENALEX_API_KEY,
            )
            if work:
                return extract_openalex_metadata(work)

        if USE_SEMANTIC_SCHOLAR_METADATA:
            paper = search_semantic_by_title(title)
            if paper:
                return extract_semantic_metadata(paper)

        if USE_CROSSREF_METADATA:
            item = search_crossref_by_title(title)
            if item:
                return extract_crossref_metadata(item)

    return None
def enrich_file(input_file, output_file, source_file=None):
    input_file = Path(input_file)
    output_file = Path(output_file)
    source_file = Path(source_file) if source_file else input_file

    output_file.parent.mkdir(parents=True, exist_ok=True)

    file_info = parse_system_file_name(source_file)
    query_word = file_info["query word"]
    dataset = file_info["dataset"]

    df = pd.read_csv(input_file, encoding="utf-8-sig")
    df.columns = [str(col).strip() for col in df.columns]

    title_col = next(
        (c for c in df.columns if c.lower() in ["title", "titles", "paper title"]),
        None,
    )
    doi_col = next((c for c in df.columns if c.lower() == "doi"), None)

    if not title_col and not doi_col:
        raise ValueError("Input file must contain at least a title or DOI column.")

    enriched_rows = []

    for idx, row in df.iterrows():
        title = row.get(title_col) if title_col else None
        doi = row.get(doi_col) if doi_col else None

        print(f"[{idx + 1}/{len(df)}] Matching: {title or doi}")

        metadata = match_single_paper(title=title, doi=doi)

        result = {col: None for col in FINAL_COLUMNS}
        result["query word"] = query_word
        result["dataset"] = dataset

        if metadata:
            result.update(metadata)
        else:
            result["title"] = title
            result["doi"] = doi

        enriched_rows.append(result)
        time.sleep(REQUEST_SLEEP)

    output_df = pd.DataFrame(enriched_rows)
    output_df = output_df.reindex(columns=FINAL_COLUMNS)

    output_df.to_csv(output_file, index=False, encoding="utf-8-sig")

    print(f"[SAVED] {output_file} | rows={len(output_df)}")


def enrich_txt_file(input_file, output_file):
    input_file = Path(input_file)
    output_file = Path(output_file)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    titles = [
        line.strip()
        for line in input_file.read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]

    df = pd.DataFrame({"title": titles})
    temp_csv = output_file.with_suffix(".temp.csv")
    df.to_csv(temp_csv, index=False, encoding="utf-8-sig")

    enrich_file(
        input_file=temp_csv,
        output_file=output_file,
        source_file=input_file,
    )

    if temp_csv.exists():
        temp_csv.unlink()


def enrich_one_output_file(input_file):
    input_file = Path(input_file)
    output_file = output_path_for_enriched_file(input_file)

    if output_file.exists() and SKIP_EXISTING_ENRICHED_FILES:
        print(f"[SKIP EXISTS] {output_file}")
        return

    print(f"\n[ENRICH START] {input_file}")

    if input_file.suffix.lower() == ".csv":
        enrich_file(
            input_file=input_file,
            output_file=output_file,
            source_file=input_file,
        )

    elif input_file.suffix.lower() == ".txt":
        enrich_txt_file(
            input_file=input_file,
            output_file=output_file,
        )

    else:
        print(f"[SKIP UNSUPPORTED FILE] {input_file}")
def find_output_files(input_dir):
    input_dir = Path(input_dir)

    if not input_dir.exists():
        print(f"[DIR NOT FOUND] {input_dir}")
        return []

    files = []
    files.extend(input_dir.glob("*.csv"))
    files.extend(input_dir.glob("*.txt"))

    return sorted(files)


def main():
    print("\n===== START: METADATA ENRICHMENT =====")

    if RUN_METADATA_ENRICHMENT_FOR_IR:
        print("\n===== IR OUTPUTS =====")
        for file in find_output_files(IR_OUTPUT_DIR):
            enrich_one_output_file(file)

    if RUN_METADATA_ENRICHMENT_FOR_LLM:
        print("\n===== LLM OUTPUTS =====")
        for file in find_output_files(LLM_OUTPUT_DIR):
            enrich_one_output_file(file)

    print("\n===== ALL DONE =====")


if __name__ == "__main__":
    main()