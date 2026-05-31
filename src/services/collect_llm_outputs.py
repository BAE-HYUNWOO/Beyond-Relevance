# ========================================================================================================
# input
# ========================================================================================================
# LLM_COLLECTION_TOPICS_BY_MODEL = {
#     "GPT": ["Econometrics"],
#     "Claude": ["Econometrics"],
#     "Gemini": ["Econometrics"],
#     "DeepSeek": ["Econometrics"]
# }
#
# OPENAI_API_KEY
# DEEPSEEK_API_KEY
# GEMINI_API_KEY
# ANTHROPIC_API_KEY
#
# OPENAI_MODEL = "gpt-5.5"
# DEEPSEEK_MODEL = "deepseek-chat"
# GEMINI_MODEL = "gemini-2.5-pro"
# ANTHROPIC_MODEL = "claude-opus-4"
#
# LLM_TEMPERATURE = 0.3
# LLM_MAX_OUTPUT_TOKENS = 8192
# LLM_MAX_TOTAL_TITLES = 100
# LLM_RUN_TAG = "20260523"

# ========================================================================================================
# output
# ========================================================================================================
# data/raw/llm_outputs/
# ├── GPT_Econometrics_20260523.txt
# ├── Claude_Econometrics_20260523.txt
# ├── Gemini_Econometrics_20260523.txt
# └── DeepSeek_Econometrics_20260523.txt
#
# txt format:
# one paper title per line

# ========================================================================================================
# run
# ========================================================================================================
# python scripts/run_llm_collection.py


import re
import time
from pathlib import Path
import os
from openai import OpenAI
import requests
from src.config.settings import (
    OPENAI_API_KEY,
    DEEPSEEK_API_KEY,
    GEMINI_API_KEY,
    ANTHROPIC_API_KEY,
    LLM_RUN_TAG,
    LLM_COLLECTION_TOPICS_BY_MODEL,
    OPENAI_MODEL,
    DEEPSEEK_MODEL,
    GEMINI_MODEL,
    ANTHROPIC_MODEL,
    LLM_TEMPERATURE,
    LLM_MAX_OUTPUT_TOKENS,
    LLM_MAX_TOTAL_TITLES,
    LLM_OUTPUT_DIR,
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", OPENAI_API_KEY)
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", DEEPSEEK_API_KEY)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", GEMINI_API_KEY)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", OPENAI_MODEL)
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", DEEPSEEK_MODEL)
GEMINI_MODEL = os.getenv("GEMINI_MODEL", GEMINI_MODEL)
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", ANTHROPIC_MODEL)

LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", LLM_TEMPERATURE))
LLM_MAX_OUTPUT_TOKENS = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", LLM_MAX_OUTPUT_TOKENS))
LLM_MAX_TOTAL_TITLES = int(os.getenv("LLM_MAX_TOTAL_TITLES", LLM_MAX_TOTAL_TITLES))
LLM_RUN_TAG = os.getenv("LLM_RUN_TAG", LLM_RUN_TAG)

LLM_QUERY = os.getenv("LLM_QUERY", "").strip()

if LLM_QUERY:
    LLM_COLLECTION_TOPICS_BY_MODEL = {
        "GPT": [LLM_QUERY],
        "Claude": [LLM_QUERY],
        "Gemini": [LLM_QUERY],
        "DeepSeek": [LLM_QUERY],
    }


def safe_name(text):
    return re.sub(r'[\\/:*?"<>|]+', "_", str(text)).strip()


def clean_response_text(text):
    if not text:
        return ""

    return "\n".join(
        line.strip()
        for line in text.replace("\r\n", "\n").replace("\r", "\n").strip().split("\n")
        if line.strip()
    )


def normalize_title_lines(text):
    output = []

    for line in clean_response_text(text).split("\n"):
        if line.startswith("```"):
            continue

        line = re.sub(r"^\s*\d+[\.\)]\s*", "", line)
        line = re.sub(r"^\s*[-*•]\s*", "", line).strip()

        if line:
            output.append(line)

    return "\n".join(output)


def clean_title_key(title):
    title = str(title).strip().lower()
    title = re.sub(r"^\s*\d+[\.\)]\s*", "", title)
    title = re.sub(r"^\s*[-*•]\s*", "", title)
    title = re.sub(r"\s+", " ", title)
    return title


def make_prompt(topic):
    return f"""I would like to better understand research in {topic}.

Please recommend up to {LLM_MAX_TOTAL_TITLES} real academic papers in this field.

Requirements:
1. Include only papers that actually exist.
2. Use the exact official paper titles whenever possible.
3. Output only titles, one per line.
4. Do not include explanations, numbering, bullets, or categories.
5. Do not ask clarifying questions.
6. Avoid repetitive title templates or formulaic variations.
7. Do not list many papers that differ only by organism, dataset, species, or entity names.
"""

def save_llm_output(topic, model_name, text):
    base_dir = Path(__file__).resolve().parents[2]
    output_dir = base_dir / "src" / "data" / "raw" / "llm_outputs"
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = output_dir / (
        f"{safe_name(model_name)}_{safe_name(topic)}_{LLM_RUN_TAG}.txt"
    )

    if output_path.exists():
        print(f"[SKIP] Already exists: {output_path}", flush=True)
        return output_path

    print(f"[SAVE] Writing file: {output_path}", flush=True)
    output_path.write_text(text, encoding="utf-8-sig")
    print(f"[SAVED] {output_path}", flush=True)

    return output_path
def collect_unique_titles(raw_text):
    text = normalize_title_lines(raw_text)

    titles = []
    seen = set()

    for line in text.split("\n"):
        title = line.strip()
        key = clean_title_key(title)

        if key and key not in seen:
            seen.add(key)
            titles.append(title)

        if len(titles) >= LLM_MAX_TOTAL_TITLES:
            break

    return "\n".join(titles)


def call_openai(topic):
    from openai import OpenAI

    print(f"[GPT] Preparing client...", flush=True)

    client = OpenAI(api_key=OPENAI_API_KEY)
    prompt = make_prompt(topic)

    print(f"[GPT] Sending request to OpenAI...", flush=True)
    print(f"[GPT] Model: {OPENAI_MODEL}", flush=True)
    print(f"[GPT] Max output tokens: {LLM_MAX_OUTPUT_TOKENS}", flush=True)

    try:
        response = client.responses.create(
            model=OPENAI_MODEL,
            input=prompt,
            temperature=LLM_TEMPERATURE,
            max_output_tokens=LLM_MAX_OUTPUT_TOKENS,
        )

    except Exception as error:
        print(f"[GPT] First request failed: {error}", flush=True)
        print("[GPT] Retrying without temperature...", flush=True)

        response = client.responses.create(
            model=OPENAI_MODEL,
            input=prompt,
            max_output_tokens=LLM_MAX_OUTPUT_TOKENS,
        )

    print("[GPT] Response received.", flush=True)

    text = response.output_text or ""

    print(f"[GPT] Raw characters: {len(text)}", flush=True)

    return text


def call_deepseek(topic):
    from openai import OpenAI

    print(f"[DeepSeek] Preparing client...", flush=True)

    client = OpenAI(
        api_key=DEEPSEEK_API_KEY,
        base_url="https://api.deepseek.com",
    )

    prompt = make_prompt(topic)

    print(f"[DeepSeek] Sending request...", flush=True)
    print(f"[DeepSeek] Model: {DEEPSEEK_MODEL}", flush=True)

    response = client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        temperature=LLM_TEMPERATURE,
        max_tokens=LLM_MAX_OUTPUT_TOKENS,
        messages=[
            {"role": "user", "content": prompt},
        ],
    )

    text = response.choices[0].message.content or ""

    print(f"[DeepSeek] Response received.", flush=True)
    print(f"[DeepSeek] Raw characters: {len(text)}", flush=True)

    return text


def call_gemini(topic):
    from google import genai

    print(f"[Gemini] Preparing client...", flush=True)

    client = genai.Client(api_key=GEMINI_API_KEY)

    prompt = make_prompt(topic)

    print(f"[Gemini] Sending request...", flush=True)
    print(f"[Gemini] Model: {GEMINI_MODEL}", flush=True)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config={
            "temperature": LLM_TEMPERATURE,
            "max_output_tokens": LLM_MAX_OUTPUT_TOKENS,
        },
    )

    text = response.text or ""

    print(f"[Gemini] Response received.", flush=True)
    print(f"[Gemini] Raw characters: {len(text)}", flush=True)

    return text


def call_anthropic(topic):
    prompt = make_prompt(topic)

    print(f"[Claude] Sending request to Anthropic...", flush=True)
    print(f"[Claude] Model: {ANTHROPIC_MODEL}", flush=True)
    print(f"[Claude] Max output tokens: {LLM_MAX_OUTPUT_TOKENS}", flush=True)
    print(f"[Claude] Temperature: {LLM_TEMPERATURE}", flush=True)

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": LLM_MAX_OUTPUT_TOKENS,
                "temperature": LLM_TEMPERATURE,
                "messages": [
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=180,
        )

        print(f"[Claude] HTTP status: {response.status_code}", flush=True)

        response.raise_for_status()

        text = "\n".join(
            block.get("text", "")
            for block in response.json().get("content", [])
            if block.get("type") == "text"
        )

        print("[Claude] Response received.", flush=True)
        print(f"[Claude] Raw characters: {len(text)}", flush=True)

        return text

    except Exception as error:
        print(f"[Claude] Request failed: {error}", flush=True)
        raise


MODEL_CALLERS = {
    "GPT": call_openai,
    "DeepSeek": call_deepseek,
    "Gemini": call_gemini,
    "Claude": call_anthropic,
}


def generate_llm_output(model_name, topic):
    if model_name not in MODEL_CALLERS:
        raise ValueError(f"Unsupported model name: {model_name}")

    base_dir = Path(__file__).resolve().parents[2]

    output_dir = base_dir / "src" / "data" / "raw" / "llm_outputs"

    output_path = output_dir / (
        f"{safe_name(model_name)}_{safe_name(topic)}_{LLM_RUN_TAG}.txt"
    )

    # ============================================================
    # API 호출 전에 먼저 skip 검사
    # ============================================================

    if output_path.exists():
        print("", flush=True)
        print("=" * 80, flush=True)
        print(f"[{model_name}] SKIP", flush=True)
        print(f"[{model_name}] Topic: {topic}", flush=True)
        print(f"[{model_name}] File already exists:", flush=True)
        print(output_path, flush=True)
        print("=" * 80, flush=True)

        return output_path

    # ============================================================
    # 실제 생성 시작
    # ============================================================

    print("", flush=True)
    print("=" * 80, flush=True)
    print(f"[{model_name}] START", flush=True)
    print(f"[{model_name}] Topic: {topic}", flush=True)
    print(f"[{model_name}] Run tag: {LLM_RUN_TAG}", flush=True)
    print("=" * 80, flush=True)

    raw_text = MODEL_CALLERS[model_name](topic)

    print(f"[{model_name}] Cleaning response...", flush=True)

    cleaned_text = collect_unique_titles(raw_text)

    title_count = len(
        [line for line in cleaned_text.split("\n") if line.strip()]
    )

    print(f"[{model_name}] Cleaned title count: {title_count}", flush=True)

    if not cleaned_text:
        raise ValueError(f"Empty LLM output: {model_name} | {topic}")

    output_path = save_llm_output(topic, model_name, cleaned_text)

    print(f"[{model_name}] DONE", flush=True)

    return output_path

def main():
    print("\n===== ALL DONE =====", flush=True)

    for model_name, topics in LLM_COLLECTION_TOPICS_BY_MODEL.items():
        print("\n" + "#" * 80)
        print(f"[MODEL START] {model_name}", flush=True)
        print("#" * 80)

        for topic in topics:
            try:
                generate_llm_output(model_name, topic)
                time.sleep(1)

            except Exception as error:
                print(f"[ERROR] {model_name} | {topic} | {error}")

    print("\n===== ALL DONE =====")


if __name__ == "__main__":
    main()
