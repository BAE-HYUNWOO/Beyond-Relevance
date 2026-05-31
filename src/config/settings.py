import os
from dotenv import load_dotenv

load_dotenv()

# =========================================================
# API KEYS
# =========================================================

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

OPENALEX_API_KEY = os.getenv("OPENALEX_API_KEY")

SEMANTIC_SCHOLAR_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY")

OPENALEX_MAILTO = os.getenv("OPENALEX_MAILTO")


# =========================================================
# DATA COLLECTION SETTINGS
# =========================================================

DATA_COLLECTION_TOPICS = [
    "Reinforcement Learning",
    "Natural Language Processing",
    "Machine Translation",
    "Genomics",
    "Econometrics",
]

COLLECTION_DATE_TAG = "20260429"

RUN_GOOGLE_SCHOLAR = False
RUN_SCOPUS = True
RUN_WOS = False

MAX_TITLES_PER_TOPIC = 130

HEADLESS_BROWSER = False

SKIP_EXISTING_FILES = True

SELENIUM_WAIT_TIME = 30

# =========================================================
# LLM COLLECTION SETTINGS
# =========================================================

LLM_RUN_TAG = "20260429_1140"

LLM_COLLECTION_TOPICS_BY_MODEL = {
    "GPT": [
        "Econometrics",
    ],
    "Gemini": [
        "Machine Translation",
        "Genomics",
    ],
}

OPENAI_MODEL = "gpt-5.4"
DEEPSEEK_MODEL = "deepseek-v4-flash"
GEMINI_MODEL = "gemini-2.5-pro"
ANTHROPIC_MODEL = "claude-opus-4-6"

LLM_TEMPERATURE = 0.1
LLM_MAX_OUTPUT_TOKENS = 4096
LLM_MAX_TOTAL_TITLES = 150

LLM_OUTPUT_DIR = "data/raw/llm_outputs"

import requests, time, re
import pandas as pd
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]

DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
FINAL_DIR = DATA_DIR / "final"

SCRIPTS_DIR = BASE_DIR / "scripts"

FRONTEND_URL = "http://localhost:5173"
MAILTO = "bhwb0307@naver.com"

TMP_DIR = Path("real_world_distribution_authors_tmp")
TMP_DIR.mkdir(exist_ok=True)

QUERY_WORDS = [
    # "Reinforcement Learning",
    # "Natural Language Processing",
    # "Machine Translation",
    # "Genomics",
    "Econometrics"
]

AUTHOR_GB = "authorships.author.id"

PER_PAGE = 200
APPEND_EVERY = 1000

SLEEP = 1.0
TIMEOUT = 180

RETRY_WAITS = [2, 5, 10, 15, 30]
MAX_429_WAIT = 60

session = requests.Session()
session.headers.update({
    "User-Agent": f"OpenAlexAuthorCollector ({MAILTO})"
})

def safe_name(x):
    return re.sub(r'[\\/:*?"<>|]+', "_", str(x).replace(" ", "_"))

def req(params):
    last = None

    for i, wait in enumerate(RETRY_WAITS, 1):
        try:
            r = session.get(
                "https://api.openalex.org/works",
                params={**params, "mailto": MAILTO},
                timeout=TIMEOUT
            )

            if r.status_code == 429:
                retry_after = min(
                    int(r.headers.get("Retry-After", wait)),
                    MAX_429_WAIT
                )
                print(f"[429] retry {i}/5 | wait {retry_after}s")
                time.sleep(retry_after)
                continue

            if r.status_code >= 500:
                print(f"[{r.status_code}] retry {i}/5 | wait {wait}s")
                time.sleep(wait)
                continue

            if r.status_code >= 400:
                print("URL:", r.url)
                print("BODY:", r.text[:500])

            r.raise_for_status()
            return r.json()

        except Exception as e:
            last = e
            print(f"[RETRY] {type(e).__name__} retry {i}/5 | wait {wait}s")
            time.sleep(wait)

    raise last

def load_existing_ids(out_file):
    if not out_file.exists():
        return set()

    try:
        df = pd.read_csv(
            out_file,
            usecols=["authors id"],
            encoding="utf-8-sig"
        )
        return set(df["authors id"].dropna().astype(str))
    except Exception:
        return set()

def append_chunk(out_file, rows, existing_ids):
    if not rows:
        return 0

    chunk = pd.DataFrame(rows)

    chunk["authors id"] = chunk["authors id"].astype(str)

    chunk = chunk[~chunk["authors id"].isin(existing_ids)]

    if chunk.empty:
        return 0

    chunk.to_csv(
        out_file,
        mode="a",
        index=False,
        header=not out_file.exists(),
        encoding="utf-8-sig"
    )

    existing_ids.update(chunk["authors id"].dropna().astype(str))

    return len(chunk)

def fetch_authors(q):
    out_file = TMP_DIR / f"{safe_name(q)}__authors.csv"
    cursor_file = TMP_DIR / f"{safe_name(q)}__cursor.txt"

    existing_ids = load_existing_ids(out_file)

    rows_buffer = []
    total_saved = 0
    page = 0

    if cursor_file.exists():
        cursor = cursor_file.read_text(encoding="utf-8").strip()
        if not cursor:
            cursor = "*"
        print(f"[RESUME] {q} | existing authors={len(existing_ids)}")
    else:
        cursor = "*"
        print(f"[START] {q}")

    print("SAVE TO:", out_file)

    while True:
        page += 1

        d = req({
            "search.title_and_abstract": q,
            "group_by": AUTHOR_GB,
            "per_page": PER_PAGE,
            "cursor": cursor
        })

        groups = d.get("group_by", [])

        if not groups:
            print("[STOP] no more groups")
            break

        for g in groups:
            rows_buffer.append({
                "authors": g.get("key_display_name") or g.get("key"),
                "authors id": g.get("key"),
                "authors count": g.get("count")
            })

        next_cursor = d.get("meta", {}).get("next_cursor")

        if len(rows_buffer) >= APPEND_EVERY:
            saved = append_chunk(out_file, rows_buffer, existing_ids)
            total_saved += saved

            print(
                f"[APPEND] {saved} new rows | "
                f"total_saved_this_run={total_saved} | "
                f"page={page} | "
                f"existing_total={len(existing_ids)}"
            )

            rows_buffer = []

            if next_cursor:
                cursor_file.write_text(next_cursor, encoding="utf-8")

        if not next_cursor:
            print("[STOP] no next cursor")
            break

        cursor = next_cursor

        time.sleep(SLEEP)

    if rows_buffer:
        saved = append_chunk(out_file, rows_buffer, existing_ids)
        total_saved += saved

        print(f"[FINAL APPEND] {saved} new rows | total_saved_this_run={total_saved}")

    if next_cursor:
        cursor_file.write_text(next_cursor, encoding="utf-8")

    print(f"[DONE] {q} | appended_this_run={total_saved}")

if __name__ == "__main__":
    for q in QUERY_WORDS:
        try:
            fetch_authors(q)
        except Exception as e:
            print(f"[ERROR] {q}: {e}")

# Metadata enrichment settings
RUN_METADATA_ENRICHMENT_FOR_IR = True
RUN_METADATA_ENRICHMENT_FOR_LLM = True
SKIP_EXISTING_ENRICHED_FILES = True

# =========================================================
# Metadata enrichment settings
# =========================================================

RUN_METADATA_ENRICHMENT_FOR_IR = True
RUN_METADATA_ENRICHMENT_FOR_LLM = True
SKIP_EXISTING_ENRICHED_FILES = True

USE_OPENALEX_METADATA = True
USE_SEMANTIC_SCHOLAR_METADATA = True
USE_CROSSREF_METADATA = True

SEMANTIC_SCHOLAR_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY")
CROSSREF_MAILTO = os.getenv("OPENALEX_MAILTO")
