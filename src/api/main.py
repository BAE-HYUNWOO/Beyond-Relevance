from pathlib import Path
import os
import subprocess

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
# from src.api.scierc_relation_api import router as scierc_relation_router
from src.api.arxiv_abstract_api import router as arxiv_abstract_router
from src.api.ecosystem_graph_api import router as ecosystem_graph_router

app = FastAPI(title="Beyond Relevance API")
# app.include_router(scierc_relation_router)
app.include_router(arxiv_abstract_router)
app.include_router(ecosystem_graph_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://beyond-relevance.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
IR_PROCESS = None


def get_base_dir():
    return Path(__file__).resolve().parents[2]


def get_data_dir():
    return get_base_dir() / "src" / "data"


def get_runtime_data_dir():
    return get_base_dir() / "data"


def get_readable_roots():
    roots = [get_data_dir(), get_runtime_data_dir()]
    out = []
    seen = set()

    for root in roots:
        resolved = root.resolve()
        if resolved not in seen:
            seen.add(resolved)
            out.append(root)

    return out


def resolve_data_file_path(path: str) -> Path:
    raw = str(path or "").replace("\\", "/").lstrip("/")
    variants = [
        raw,
        raw[5:] if raw.startswith("data/") else raw,
        raw[len("src/data/") :] if raw.startswith("src/data/") else raw,
    ]

    for root in get_readable_roots():
        root_resolved = root.resolve()

        for variant in dict.fromkeys(variants):
            file_path = (root / variant).resolve()

            if not str(file_path).startswith(str(root_resolved)):
                continue

            if file_path.exists() and file_path.is_file():
                return file_path

    raise HTTPException(status_code=404, detail="File not found")


@app.get("/")
def health_check():
    return {"status": "ok"}


@app.post("/api/merge/raw-to-processed")
def merge_raw_files():
    base_dir = get_base_dir()
    data_dir = get_data_dir()

    matched_dir = data_dir / "processed" / "matched_titles"
    output_dir = data_dir / "processed" / "systems_distribution"
    output_file = output_dir / "systems_distribution.csv"

    output_dir.mkdir(parents=True, exist_ok=True)

    frames = []
    files = []

    if not matched_dir.exists():
        return {
            "success": False,
            "message": f"Input folder not found: {matched_dir}",
        }

    for file in matched_dir.glob("*.csv"):
        df = pd.read_csv(file, encoding="utf-8-sig", low_memory=False)
        df["source_file"] = file.name
        frames.append(df)
        files.append(file.name)

    if not frames:
        pd.DataFrame().to_csv(output_file, index=False, encoding="utf-8-sig")
        return {
            "success": True,
            "message": "No CSV files found. Empty systems_distribution.csv created.",
            "rows": 0,
            "files": 0,
            "output": str(output_file),
        }

    merged = pd.concat(frames, ignore_index=True, sort=False)
    merged.to_csv(output_file, index=False, encoding="utf-8-sig")

    return {
        "success": True,
        "message": "Merged matched_titles into systems_distribution.",
        "rows": len(merged),
        "files": len(files),
        "merged_files": files,
        "output": str(output_file),
    }


@app.post("/api/llms/run")
async def run_llm_collection(request: Request):
    body = await request.json()

    query = body.get("query", "").strip()
    config = body.get("llmConfig") or body.get("config", {}) or {}

    run_date = body.get("runDate", "").strip()
    run_time = body.get("runTime", "").strip()

    if not run_date or not run_time:
        return StreamingResponse(
            iter(["[ERROR] RUN_DATE and RUN_TIME are required.\n"]),
            media_type="text/plain",
        )

    run_tag = run_date.replace("-", "") + "_" + run_time.replace(":", "")
    config["LLM_RUN_TAG"] = run_tag

    base_dir = get_base_dir()
    script_module = "src.services.collect_llm_outputs"

    env = os.environ.copy()
    env["LLM_QUERY"] = query
    env["LLM_RUN_TAG"] = run_tag

    for key, value in config.items():
        env[key] = str(value)

    def stream():
        yield "[START]\n"
        yield f"QUERY: {query}\n"
        yield f"RUN DATE: {run_date}\n"
        yield f"RUN TIME: {run_time}\n"
        yield f"RUN TAG: {run_tag}\n"
        yield f"BASE DIR: {base_dir}\n"
        yield f"MODULE: {script_module}\n\n"

        if not query:
            yield "[ERROR] Search query is empty.\n"
            return

        process = subprocess.Popen(
            ["python", "-m", script_module],
            cwd=str(base_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        if process.stdout:
            for line in process.stdout:
                yield line

        process.wait()

        yield "\n"
        yield f"[FINISHED] RETURN CODE = {process.returncode}\n"

    return StreamingResponse(stream(), media_type="text/plain")


@app.get("/api/data/tree")
def get_data_tree():
    data_dir = get_data_dir()

    if not data_dir.exists():
        return {
            "success": False,
            "message": f"Data folder not found: {data_dir}",
            "tree": [],
        }

    def build_tree(path):
        items = []

        for child in sorted(
            path.iterdir(), key=lambda x: (x.is_file(), x.name.lower())
        ):
            rel_path = child.relative_to(data_dir).as_posix()

            if child.is_dir():
                items.append(
                    {
                        "name": child.name,
                        "path": rel_path,
                        "type": "folder",
                        "children": build_tree(child),
                    }
                )
            else:
                items.append(
                    {
                        "name": child.name,
                        "path": rel_path,
                        "type": "file",
                        "size": child.stat().st_size,
                    }
                )

        return items

    return {
        "success": True,
        "root": str(data_dir),
        "tree": build_tree(data_dir),
    }


@app.get("/api/data/file")
def read_data_file(path: str):
    file_path = resolve_data_file_path(path)

    if file_path.stat().st_size > 2_000_000:
        return PlainTextResponse("File too large to preview.", status_code=200)

    return PlainTextResponse(
        file_path.read_text(encoding="utf-8-sig", errors="replace")
    )


from fastapi.responses import StreamingResponse
import subprocess
import os

from fastapi import Request


@app.post("/api/ir/run")
async def run_ir_collection(request: Request):
    global IR_PROCESS

    body = await request.json()

    base_dir = get_base_dir()
    collect_module = "src.services.collect_ir_outputs"
    match_module = "src.services.ir_match_outputs"

    query = body.get("query", "").strip()
    run_date = body.get("runDate", "").strip()
    run_time = body.get("runTime", "").strip()
    max_rows = str(body.get("maxRows", "100") or "100").strip()
    systems = body.get("systems") or ["google_scholar"]
    run_matching = bool(body.get("runMatching", True))

    if isinstance(systems, str):
        systems = [systems]

    allowed_systems = {"google_scholar", "scopus", "web_of_science"}
    systems = [s for s in systems if s in allowed_systems]

    if not max_rows.isdigit():
        max_rows = "100"

    run_tag = run_date.replace("-", "") + "_" + run_time.replace(":", "")

    base_env = os.environ.copy()
    base_env["IR_QUERY"] = query
    base_env["COLLECTION_DATE_TAG"] = run_tag

    base_env["OPENALEX_API_KEY"] = body.get("openAlexApiKey", "")
    base_env["SEMANTIC_API_KEY"] = body.get("semanticApiKey", "")

    base_env["MAX_TITLES_PER_TOPIC"] = max_rows
    base_env["HEADLESS_BROWSER"] = "false"
    base_env["SKIP_EXISTING_FILES"] = "true"

    base_env["GOOGLE_SCHOLAR_HL"] = "en"
    base_env["GOOGLE_SCHOLAR_LR"] = "lang_en"
    base_env["CHROME_LANG"] = "en-US"

    base_env["PYTHONUNBUFFERED"] = "1"
    base_env["PYTHONIOENCODING"] = "utf-8"
    base_env["PYTHONUTF8"] = "1"
    base_env["IR_OUTPUT_ROOT"] = str(base_dir / "data" / "raw" / "ir_outputs")

    system_name_map = {
        "google_scholar": "Google Scholar",
        "scopus": "Scopus",
        "web_of_science": "Web of Science",
    }

    def safe_file_part(value: str) -> str:
        return "".join("_" if c in '\\\\/:*?"<>|' else c for c in value).strip()

    safe_query = safe_file_part(query)

    def output_name_for(system_id: str) -> str:
        safe_system = safe_file_part(system_name_map[system_id])
        return f"{safe_system}_{safe_query}_{run_tag}.csv"

    def env_for_single_system(system_id: str) -> dict:
        env = base_env.copy()
        env["RUN_GOOGLE_SCHOLAR"] = "true" if system_id == "google_scholar" else "false"
        env["RUN_SCOPUS"] = "true" if system_id == "scopus" else "false"
        env["RUN_WOS"] = "true" if system_id == "web_of_science" else "false"
        env["IR_MATCH_INPUT_FILES"] = output_name_for(system_id)
        return env

    def run_subprocess(module_name, env):
        return subprocess.Popen(
            ["python", "-u", "-X", "utf8", "-m", module_name],
            cwd=str(base_dir),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

    def stream():
        global IR_PROCESS

        yield "[START]\n"
        yield "[1] STREAM STARTED\n"
        yield f"QUERY: {query}\n"
        yield f"RUN TAG: {run_tag}\n"
        yield f"MAX ROWS: {max_rows}\n"
        yield f"SYSTEM ORDER: {', '.join(system_name_map[s] for s in systems) if systems else 'None'}\n"
        yield "LANGUAGE: English / hl=en\n\n"

        if not query:
            yield "[ERROR] Search query is empty.\n"
            return

        if not systems:
            yield "[ERROR] Select at least one IR system.\n"
            return

        if IR_PROCESS is not None and IR_PROCESS.poll() is None:
            yield "[ERROR] Another IR process is already running.\n"
            return

        try:
            for system_id in systems:
                system_label = system_name_map[system_id]
                single_env = env_for_single_system(system_id)

                yield f"\n[2] CRAWLING START: {system_label}\n"
                IR_PROCESS = run_subprocess(collect_module, single_env)

                if IR_PROCESS.stdout is None:
                    yield "[ERROR] Subprocess stdout is not available.\n"
                    return

                for line in IR_PROCESS.stdout:
                    yield line

                IR_PROCESS.wait()
                yield "\n"
                yield f"[CRAWLING FINISHED: {system_label}] RETURN CODE = {IR_PROCESS.returncode}\n"

                if IR_PROCESS.returncode != 0:
                    yield f"[STOP] Matching skipped for {system_label} because crawling failed.\n"
                    continue

                if not run_matching:
                    yield f"[SKIP] Matching disabled for {system_label}.\n"
                    continue

                yield f"\n[3] MATCHING START: {system_label} DOI/title matching via dataset/OpenAlex/Semantic Scholar/Crossref\n"
                match_process = run_subprocess(match_module, single_env)

                if match_process.stdout is None:
                    yield "[ERROR] Matching stdout is not available.\n"
                    return

                for line in match_process.stdout:
                    yield line

                match_process.wait()
                yield "\n"
                yield f"[MATCHING FINISHED: {system_label}] RETURN CODE = {match_process.returncode}\n"

            yield "[DONE] Crawling + matching completed.\n"

        except Exception as error:
            yield "\n"
            yield "[BACKEND ERROR]\n"
            yield f"{type(error).__name__}: {error}\n"

        finally:
            try:
                if IR_PROCESS and IR_PROCESS.stdout:
                    IR_PROCESS.stdout.close()
            except Exception:
                pass

            IR_PROCESS = None

    return StreamingResponse(
        stream(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/ir/latest-matched")
def latest_ir_matched_csv():
    data_dir = get_data_dir()
    base_dir = get_base_dir()
    candidates = [
        base_dir / "data" / "raw" / "ir_outputs" / "Systems_Distribution.csv",
        data_dir / "raw" / "ir_outputs" / "Systems_Distribution.csv",
        base_dir / "Systems_Distribution.csv",
    ]

    found_dir = base_dir / "data" / "raw" / "ir_outputs" / "found_titles"
    if found_dir.exists():
        candidates.extend(
            sorted(
                found_dir.glob("*_found.csv"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        )

    for path in candidates:
        if path.exists() and path.is_file():
            return {
                "success": True,
                "path": str(path),
                "filename": path.name,
                "content": path.read_text(encoding="utf-8-sig", errors="replace"),
            }

    return {"success": False, "message": "No matched CSV found yet."}


@app.get("/api/ir/download-matched")
def download_ir_matched_csv():
    data_dir = get_data_dir()
    base_dir = get_base_dir()
    candidates = [
        base_dir / "data" / "raw" / "ir_outputs" / "Systems_Distribution.csv",
        data_dir / "raw" / "ir_outputs" / "Systems_Distribution.csv",
        base_dir / "Systems_Distribution.csv",
    ]

    found_dir = base_dir / "data" / "raw" / "ir_outputs" / "found_titles"
    if found_dir.exists():
        candidates.extend(
            sorted(
                found_dir.glob("*_found.csv"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        )

    for path in candidates:
        if path.exists() and path.is_file():
            return FileResponse(
                path,
                media_type="text/csv",
                filename=path.name,
            )

    raise HTTPException(status_code=404, detail="No matched CSV found yet.")


@app.post("/api/ir/continue")
def continue_ir_collection():
    global IR_PROCESS

    if IR_PROCESS is None:
        return {
            "success": False,
            "message": "No active IR process.",
        }

    if IR_PROCESS.stdin is None:
        return {
            "success": False,
            "message": "IR process stdin is not available.",
        }

    if IR_PROCESS.poll() is not None:
        return {
            "success": False,
            "message": f"IR process already ended. returncode={IR_PROCESS.returncode}",
        }

    try:
        IR_PROCESS.stdin.write("\n")
        IR_PROCESS.stdin.flush()

        return {
            "success": True,
            "message": "Continue signal sent.",
        }

    except Exception as error:
        return {
            "success": False,
            "message": f"Failed to send continue signal: {type(error).__name__}: {error}",
        }


@app.post("/api/ir/stop")
def stop_ir_collection():
    global IR_PROCESS

    if IR_PROCESS is None or IR_PROCESS.poll() is not None:
        return {"success": False, "message": "No active IR process."}

    try:
        IR_PROCESS.terminate()
        return {"success": True, "message": "Stop signal sent."}
    except Exception as error:
        return {
            "success": False,
            "message": f"Failed to stop process: {type(error).__name__}: {error}",
        }


@app.get("/api/ir/status")
def ir_process_status():
    global IR_PROCESS

    if IR_PROCESS is None:
        return {
            "running": False,
            "returncode": None,
        }

    return {
        "running": IR_PROCESS.poll() is None,
        "returncode": IR_PROCESS.poll(),
    }


from src.api.benchmark_match_api import router as benchmark_match_router

app.include_router(benchmark_match_router)
