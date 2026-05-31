# src/data_collection/merge_distributions.py

from pathlib import Path
import pandas as pd


SYSTEMS_DISTRIBUTION_DIR = Path("data/processed/systems_distribution")
REAL_WORLD_DISTRIBUTION_DIR = Path("data/processed/real_world_distribution")

FINAL_OUTPUT_DIR = Path("data/final")

SYSTEMS_OUTPUT_FILE = FINAL_OUTPUT_DIR / "Systems_Distribution.csv"
REAL_WORLD_OUTPUT_FILE = FINAL_OUTPUT_DIR / "Real_World_Distribution.csv"


def merge_systems_distribution():
    FINAL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    files = sorted(SYSTEMS_DISTRIBUTION_DIR.glob("*_enriched.csv"))

    if not files:
        print("[NO SYSTEM FILES]")
        return

    dfs = []

    for file in files:
        print(f"[LOAD SYSTEM] {file.name}")

        df = pd.read_csv(file, encoding="utf-8-sig")

        df["source file"] = file.name

        dfs.append(df)

    merged = pd.concat(dfs, ignore_index=True)

    merged.to_csv(
        SYSTEMS_OUTPUT_FILE,
        index=False,
        encoding="utf-8-sig",
    )

    print(f"[SAVED SYSTEMS] {SYSTEMS_OUTPUT_FILE} | rows={len(merged)}")


def merge_real_world_distribution():
    FINAL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    files = sorted(REAL_WORLD_DISTRIBUTION_DIR.glob("*.csv"))

    if not files:
        print("[NO REAL WORLD FILES]")
        return

    dfs = []

    for file in files:
        print(f"[LOAD REAL WORLD] {file.name}")

        df = pd.read_csv(file, encoding="utf-8-sig")

        df["source file"] = file.name

        dfs.append(df)

    merged = pd.concat(dfs, ignore_index=True)

    merged.to_csv(
        REAL_WORLD_OUTPUT_FILE,
        index=False,
        encoding="utf-8-sig",
    )

    print(f"[SAVED REAL WORLD] {REAL_WORLD_OUTPUT_FILE} | rows={len(merged)}")


def main():
    print("\n===== MERGE DISTRIBUTIONS =====")

    merge_systems_distribution()
    merge_real_world_distribution()

    print("\n===== ALL DONE =====")


if __name__ == "__main__":
    main()