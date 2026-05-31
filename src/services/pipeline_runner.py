import subprocess
import sys
from pathlib import Path
from src.config.settings import BASE_DIR, SCRIPTS_DIR


def run_script(script_name: str) -> dict:
    script_path = SCRIPTS_DIR / script_name

    if not script_path.exists():
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Script not found: {script_path}",
        }

    result = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
    )

    return {
        "success": result.returncode == 0,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }