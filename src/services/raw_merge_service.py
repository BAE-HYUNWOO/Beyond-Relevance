from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[3]

FRONTEND_DATA_DIR = (
    BASE_DIR
    / "frontend"
    / "src"
    / "data"
)

MATCHED_TITLES_DIR = (
    FRONTEND_DATA_DIR
    / "processed"
    / "matched_titles"
)

SYSTEMS_DISTRIBUTION_DIR = (
    FRONTEND_DATA_DIR
    / "processed"
    / "systems_distribution"
)

SYSTEMS_DISTRIBUTION_FILE = (
    SYSTEMS_DISTRIBUTION_DIR
    / "systems_distribution.csv"
)


def merge_matched_titles_to_systems_distribution() -> dict:

    SYSTEMS_DISTRIBUTION_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    frames = []
    files = []

    if not MATCHED_TITLES_DIR.exists():
        return {
            "success": False,
            "message": f"Input folder not found: {MATCHED_TITLES_DIR}",
            "output": str(SYSTEMS_DISTRIBUTION_FILE),
        }

    csv_files = list(MATCHED_TITLES_DIR.glob("*.csv"))

    for file in csv_files:

        df = pd.read_csv(
            file,
            encoding="utf-8-sig",
            low_memory=False,
        )

        df["source_file"] = file.name

        frames.append(df)
        files.append(file.name)

    if len(frames) == 0:

        pd.DataFrame().to_csv(
            SYSTEMS_DISTRIBUTION_FILE,
            index=False,
            encoding="utf-8-sig",
        )

        return {
            "success": True,
            "message": "No CSV files found.",
            "output": str(SYSTEMS_DISTRIBUTION_FILE),
            "files": 0,
            "rows": 0,
        }

    merged = pd.concat(
        frames,
        ignore_index=True,
        sort=False,
    )

    merged.to_csv(
        SYSTEMS_DISTRIBUTION_FILE,
        index=False,
        encoding="utf-8-sig",
    )

    return {
        "success": True,
        "message": "systems_distribution.csv created successfully.",
        "input_folder": str(MATCHED_TITLES_DIR),
        "output": str(SYSTEMS_DISTRIBUTION_FILE),
        "files": len(files),
        "rows": len(merged),
        "merged_files": files,
    }


def merge_raw_to_processed() -> dict:

    result = merge_matched_titles_to_systems_distribution()

    return {
        "success": result["success"],
        "systems_distribution": result,
    }