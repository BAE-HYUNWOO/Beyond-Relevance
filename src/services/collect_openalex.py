# ========================================================================================================
# input
# ========================================================================================================
# OPENALEX_COLLECTION_TOPICS = ["Econometrics", "Reinforcement Learning"]
# RUN_OPENALEX_NON_AUTHOR_DISTRIBUTION = True
# RUN_OPENALEX_AUTHOR_DISTRIBUTION = True
# OPENALEX_API_KEY = "..."
# OPENALEX_MAILTO = "example@gmail.com"
# OPENALEX_PER_PAGE = 200
# OPENALEX_APPEND_EVERY = 1000
# OPENALEX_SLEEP = 1
# OPENALEX_TIMEOUT = 180
# OPENALEX_RETRY_WAITS = [2,5,10,15,30]
# OPENALEX_MAX_429_WAIT = 60

# ========================================================================================================
# output
# ========================================================================================================
# data/processed/real_world_distribution/
# ├── Real World Distribution_Econometrics_non_authors.csv
# ├── Real World Distribution_Econometrics_authors.csv
# ├── Real World Distribution_Reinforcement Learning_non_authors.csv
# └── Real World Distribution_Reinforcement Learning_authors.csv
#
# data/raw/openalex_tmp/
# ├── Econometrics__primary_topic.csv
# ├── Econometrics__authors_cursor.txt
# └── ...
#
# non_authors.csv columns:
# sum count
# year, cited by, year count, year percentage
# is oa, is oa count, is oa percentage
# primary topic, primary topic count, primary topic percentage
# institutions, institutions count, institutions percentage
# type, type count, type percentage
# primary subfield, primary subfield count, primary subfield percentage
# open access status, open access status count, open access status percentage
# publisher, publisher count, publisher percentage
# primary domain, primary domain count, primary domain percentage
# source type, source type count, source type percentage
# primary field, primary field count, primary field percentage
# publication venue, publication venue count, publication venue percentage
#
# authors.csv columns:
# authors, authors id, authors count

# ========================================================================================================
# run
# ========================================================================================================
# python scripts/run_openalex_collection.py


import re
import time
from pathlib import Path

import pandas as pd
import requests

from src.config.settings import (
    OPENALEX_API_KEY,
    OPENALEX_MAILTO,
    OPENALEX_COLLECTION_TOPICS,
    RUN_OPENALEX_NON_AUTHOR_DISTRIBUTION,
    RUN_OPENALEX_AUTHOR_DISTRIBUTION,
    OPENALEX_REAL_WORLD_OUTPUT_DIR,
    OPENALEX_REAL_WORLD_TMP_DIR,
    OPENALEX_PER_PAGE,
    OPENALEX_APPEND_EVERY,
    OPENALEX_SLEEP,
    OPENALEX_TIMEOUT,
    OPENALEX_RETRY_WAITS,
    OPENALEX_MAX_429_WAIT,
)


OPENALEX_WORKS_URL = "https://api.openalex.org/works"

NO_CURSOR_GROUPS = {
    "open_access.is_oa",
    "publication_year",
    "type",
    "open_access.oa_status",
    "primary_location.source.type",
}

NON_AUTHOR_GROUPS = {
    "year": ("publication_year", "year"),
    "is oa": ("open_access.is_oa", "is oa"),
    "primary topic": ("primary_topic.id", "primary topic"),
    "institutions": ("authorships.institutions.lineage", "institutions"),
    "type": ("type", "type"),
    "primary subfield": ("primary_topic.subfield.id", "primary subfield"),
    "open access status": ("open_access.oa_status", "open access status"),
    "publisher": ("primary_location.source.host_organization_lineage", "publisher"),
    "primary domain": ("primary_topic.domain.id", "primary domain"),
    "source type": ("primary_location.source.type", "source type"),
    "primary field": ("primary_topic.field.id", "primary field"),
    "publication venue": ("primary_location.source.id", "publication venue"),
}

AUTHOR_GROUP_BY = "authorships.author.id"


def safe_name(value):
    return re.sub(r'[\\/:*?"<>|]+', "_", str(value).replace(" ", "_"))


def make_session():
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": f"OpenAlexCollector ({OPENALEX_MAILTO})",
        }
    )
    return session


def request_openalex(session, params):
    last_error = None

    base_params = {
        **params,
        "mailto": OPENALEX_MAILTO,
    }

    if OPENALEX_API_KEY:
        base_params["api_key"] = OPENALEX_API_KEY

    for attempt, wait in enumerate(OPENALEX_RETRY_WAITS, 1):
        try:
            response = session.get(
                OPENALEX_WORKS_URL,
                params=base_params,
                timeout=OPENALEX_TIMEOUT,
            )

            if response.status_code == 429:
                retry_after = min(
                    int(response.headers.get("Retry-After", wait)),
                    OPENALEX_MAX_429_WAIT,
                )
                print(f"[429] retry {attempt}/5 | wait {retry_after}s")
                time.sleep(retry_after)
                continue

            if response.status_code >= 500:
                print(f"[{response.status_code}] retry {attempt}/5 | wait {wait}s")
                time.sleep(wait)
                continue

            if response.status_code >= 400:
                print("URL:", response.url)
                print("BODY:", response.text[:500])

            response.raise_for_status()
            return response.json()

        except Exception as error:
            last_error = error
            print(
                f"[RETRY] {type(error).__name__} "
                f"retry {attempt}/5 | wait {wait}s"
            )
            time.sleep(wait)

    raise last_error


def fetch_total_count(session, topic):
    data = request_openalex(
        session,
        {
            "search.title_and_abstract": topic,
            "per_page": 1,
        },
    )

    return data["meta"]["count"]


def fetch_group_distribution(session, topic, label, group_by, limit=None):
    tmp_dir = Path(OPENALEX_REAL_WORLD_TMP_DIR)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    cache_file = tmp_dir / f"{safe_name(topic)}__{safe_name(label)}.csv"

    if cache_file.exists():
        print(f"  cache load {label}: {cache_file}")
        df = pd.read_csv(cache_file, encoding="utf-8-sig")
        return df.head(limit) if limit else df

    def fetch_without_cursor(group_by_value):
        data = request_openalex(
            session,
            {
                "search.title_and_abstract": topic,
                "group_by": group_by_value,
                "per_page": OPENALEX_PER_PAGE,
            },
        )

        df = pd.DataFrame(
            [
                {
                    "value": group.get("key_display_name") or group.get("key"),
                    "count": group.get("count"),
                }
                for group in data.get("group_by", [])
            ]
        )

        if limit:
            df = df.head(limit)

        df.to_csv(cache_file, index=False, encoding="utf-8-sig")
        return df

    if group_by in NO_CURSOR_GROUPS or limit:
        try:
            return fetch_without_cursor(group_by + ":include_unknown")
        except Exception:
            return fetch_without_cursor(group_by)

    rows = []
    cursor = "*"
    page = 0
    group_by_value = group_by + ":include_unknown"

    while True:
        page += 1

        try:
            data = request_openalex(
                session,
                {
                    "search.title_and_abstract": topic,
                    "group_by": group_by_value,
                    "per_page": OPENALEX_PER_PAGE,
                    "cursor": cursor,
                },
            )
        except Exception:
            group_by_value = group_by
            data = request_openalex(
                session,
                {
                    "search.title_and_abstract": topic,
                    "group_by": group_by_value,
                    "per_page": OPENALEX_PER_PAGE,
                    "cursor": cursor,
                },
            )

        groups = data.get("group_by", [])

        if not groups:
            break

        rows.extend(
            [
                {
                    "value": group.get("key_display_name") or group.get("key"),
                    "count": group.get("count"),
                }
                for group in groups
            ]
        )

        if page % 10 == 0 or page == 1:
            print(f"    {label} page={page} | rows={len(rows)}")

        pd.DataFrame(rows).to_csv(cache_file, index=False, encoding="utf-8-sig")

        next_cursor = data.get("meta", {}).get("next_cursor")

        if not next_cursor:
            break

        cursor = next_cursor
        time.sleep(OPENALEX_SLEEP)

    return pd.DataFrame(rows)


def make_distribution_part(session, topic, label, group_by, column, limit=None):
    df = fetch_group_distribution(
        session=session,
        topic=topic,
        label=label,
        group_by=group_by,
        limit=limit,
    )

    if column == "year":
        df = df.rename(columns={"value": "year", "count": "year count"})
        df["cited by"] = None
        df["year percentage"] = df["year count"] / df["year count"].sum()

        return df[["year", "cited by", "year count", "year percentage"]]

    df = df.rename(columns={"value": column, "count": f"{column} count"})

    denominator = df[f"{column} count"].sum()
    df[f"{column} percentage"] = (
        df[f"{column} count"] / denominator if denominator else 0
    )

    return df[[column, f"{column} count", f"{column} percentage"]]


def build_non_author_distribution(topic):
    output_dir = Path(OPENALEX_REAL_WORLD_OUTPUT_DIR)
    output_dir.mkdir(parents=True, exist_ok=True)

    session = make_session()

    try:
        total_count = fetch_total_count(session, topic)
        parts = []

        for label, (group_by, column) in NON_AUTHOR_GROUPS.items():
            part = make_distribution_part(
                session=session,
                topic=topic,
                label=label,
                group_by=group_by,
                column=column,
            )

            parts.append(part)
            print(f"  fetched {label}: {len(part)}")

        max_len = max(len(part) for part in parts)

        output = pd.DataFrame(
            {
                "sum count": [total_count] * max_len,
            }
        )

        for part in parts:
            part = part.reset_index(drop=True).reindex(range(max_len))

            for column in part.columns:
                output[column] = part[column]

        columns = ["sum count"]

        for _, column in NON_AUTHOR_GROUPS.values():
            if column == "year":
                columns += ["year", "cited by", "year count", "year percentage"]
            else:
                columns += [column, f"{column} count", f"{column} percentage"]

        output = output[[column for column in columns if column in output.columns]]

        output_file = output_dir / f"Real World Distribution_{safe_name(topic)}_non_authors.csv"

        output.to_csv(output_file, index=False, encoding="utf-8-sig")

        print(f"[SAVED NON-AUTHOR] {output_file} | rows={len(output)}")

    finally:
        session.close()


def load_existing_author_ids(output_file):
    if not output_file.exists():
        return set()

    try:
        df = pd.read_csv(
            output_file,
            usecols=["authors id"],
            encoding="utf-8-sig",
        )
        return set(df["authors id"].dropna().astype(str))

    except Exception:
        return set()


def append_author_chunk(output_file, rows, existing_ids):
    if not rows:
        return 0

    chunk = pd.DataFrame(rows)
    chunk["authors id"] = chunk["authors id"].astype(str)

    chunk = chunk[~chunk["authors id"].isin(existing_ids)]

    if chunk.empty:
        return 0

    chunk.to_csv(
        output_file,
        mode="a",
        index=False,
        header=not output_file.exists(),
        encoding="utf-8-sig",
    )

    existing_ids.update(chunk["authors id"].dropna().astype(str))

    return len(chunk)


def build_author_distribution(topic):
    output_dir = Path(OPENALEX_REAL_WORLD_OUTPUT_DIR)
    tmp_dir = Path(OPENALEX_REAL_WORLD_TMP_DIR)

    output_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    output_file = output_dir / f"Real World Distribution_{safe_name(topic)}_authors.csv"
    cursor_file = tmp_dir / f"{safe_name(topic)}__authors_cursor.txt"

    existing_ids = load_existing_author_ids(output_file)

    rows_buffer = []
    total_saved = 0
    page = 0

    if cursor_file.exists():
        cursor = cursor_file.read_text(encoding="utf-8").strip()

        if not cursor:
            cursor = "*"

        print(f"[RESUME AUTHORS] {topic} | existing authors={len(existing_ids)}")

    else:
        cursor = "*"
        print(f"[START AUTHORS] {topic}")

    print("SAVE TO:", output_file)

    session = make_session()

    try:
        next_cursor = None

        while True:
            page += 1

            data = request_openalex(
                session,
                {
                    "search.title_and_abstract": topic,
                    "group_by": AUTHOR_GROUP_BY,
                    "per_page": OPENALEX_PER_PAGE,
                    "cursor": cursor,
                },
            )

            groups = data.get("group_by", [])

            if not groups:
                print("[STOP AUTHORS] no more groups")
                break

            for group in groups:
                rows_buffer.append(
                    {
                        "authors": group.get("key_display_name") or group.get("key"),
                        "authors id": group.get("key"),
                        "authors count": group.get("count"),
                    }
                )

            next_cursor = data.get("meta", {}).get("next_cursor")

            if len(rows_buffer) >= OPENALEX_APPEND_EVERY:
                saved = append_author_chunk(output_file, rows_buffer, existing_ids)
                total_saved += saved

                print(
                    f"[APPEND AUTHORS] {saved} new rows | "
                    f"total_saved_this_run={total_saved} | "
                    f"page={page} | "
                    f"existing_total={len(existing_ids)}"
                )

                rows_buffer = []

                if next_cursor:
                    cursor_file.write_text(next_cursor, encoding="utf-8")

            if not next_cursor:
                print("[STOP AUTHORS] no next cursor")
                break

            cursor = next_cursor
            time.sleep(OPENALEX_SLEEP)

        if rows_buffer:
            saved = append_author_chunk(output_file, rows_buffer, existing_ids)
            total_saved += saved

            print(
                f"[FINAL APPEND AUTHORS] {saved} new rows | "
                f"total_saved_this_run={total_saved}"
            )

        if next_cursor:
            cursor_file.write_text(next_cursor, encoding="utf-8")

        print(f"[DONE AUTHORS] {topic} | appended_this_run={total_saved}")

    finally:
        session.close()


def main():
    print("\n===== START: OPENALEX REAL-WORLD DISTRIBUTION COLLECTION =====")

    for topic in OPENALEX_COLLECTION_TOPICS:
        print("\n" + "=" * 90)
        print("TOPIC:", topic)

        try:
            if RUN_OPENALEX_NON_AUTHOR_DISTRIBUTION:
                print("\n----- NON-AUTHOR DISTRIBUTION -----")
                build_non_author_distribution(topic)

            if RUN_OPENALEX_AUTHOR_DISTRIBUTION:
                print("\n----- AUTHOR DISTRIBUTION -----")
                build_author_distribution(topic)

        except Exception as error:
            print(f"[ERROR] {topic}: {error}")

    print("\n===== ALL DONE =====")


if __name__ == "__main__":
    main()