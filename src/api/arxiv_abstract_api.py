from __future__ import annotations

import csv
import re
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/arxiv", tags=["arXiv Abstract Collector"])


class ArxivCollectRequest(BaseModel):
    url: str = Field(default="https://arxiv.org/list/cs.AI/recent")
    max_papers: int = Field(default=100, ge=1, le=10000)
    delay_per_paper: float = Field(default=0.2, ge=0, le=10)
    show_browser: bool = Field(default=True)


def _base_dir() -> Path:
    # src/api/arxiv_abstract_api.py -> project root
    return Path(__file__).resolve().parents[2]


def _output_dir() -> Path:
    out = _base_dir() / "data" / "raw" / "arxiv_abstracts"
    out.mkdir(parents=True, exist_ok=True)
    return out


def _safe_slug(value: str) -> str:
    value = value.strip()
    value = re.sub(r"^https?://", "", value)
    value = value.replace("/", "_").replace("?", "_").replace("&", "_").replace("=", "-")
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value[:90] or "arxiv_abstracts"


def _make_list_url(source_url: str, max_papers: int) -> str:
    parsed = urlparse(source_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["skip"] = "0"
    # arXiv supports show=2000 for recent list. Larger values are harmless but may be capped by arXiv.
    query["show"] = str(max(max_papers, 2000))
    return urlunparse(parsed._replace(query=urlencode(query)))


def _text_without_descriptor(tag, descriptor: str) -> str:
    if tag is None:
        return ""
    desc = tag.find(class_="descriptor")
    if desc:
        desc.extract()
    text = tag.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(rf"^{re.escape(descriptor)}\s*:?\s*", "", text, flags=re.I)
    return text


def _extract_abs_links(list_html: str, source_url: str, max_papers: int) -> List[str]:
    soup = BeautifulSoup(list_html, "html.parser")
    links: List[str] = []
    seen = set()

    for a in soup.select('a[title="Abstract"]'):
        href = a.get("href") or ""
        if "/abs/" not in href:
            continue
        url = urljoin(source_url, href)
        if url in seen:
            continue
        seen.add(url)
        links.append(url)
        if len(links) >= max_papers:
            break

    return links


def _parse_abs_page(abs_url: str, html: str, source_url: str, collected_at: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    paper_id = abs_url.rstrip("/").split("/abs/")[-1]

    title = _text_without_descriptor(soup.find("h1", class_="title"), "Title")
    abstract = _text_without_descriptor(soup.find("blockquote", class_="abstract"), "Abstract")
    authors = _text_without_descriptor(soup.find("div", class_="authors"), "Authors")

    return {
        "paper_id": paper_id,
        "title": title,
        "authors": authors,
        "abstract": abstract,
        "url": abs_url,
        "source_url": source_url,
        "collected_at": collected_at,
    }


def _save_csv(records: List[dict], source_url: str) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{_safe_slug(source_url)}_{timestamp}.csv"
    path = _output_dir() / filename

    fields = ["paper_id", "title", "authors", "abstract", "url", "source_url", "collected_at"]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in records:
            writer.writerow({key: row.get(key, "") for key in fields})

    return path


def _collect_with_selenium(req: ArxivCollectRequest) -> List[dict]:
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=(
                "Selenium is not installed. Run: pip install selenium beautifulsoup4 pandas"
            ),
        ) from exc

    options = Options()
    if not req.show_browser:
        options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1500,950")
    options.add_argument("--lang=en-US")

    driver = None
    records: List[dict] = []
    collected_at = datetime.now().isoformat(timespec="seconds")

    try:
        driver = webdriver.Chrome(options=options)
        driver.set_page_load_timeout(60)

        list_url = _make_list_url(req.url, req.max_papers)
        driver.get(list_url)

        WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, 'a[title="Abstract"]'))
        )

        links = _extract_abs_links(driver.page_source, list_url, req.max_papers)
        if not links:
            raise HTTPException(status_code=404, detail="No arXiv abstract links found on the list page.")

        for idx, abs_url in enumerate(links, start=1):
            driver.get(abs_url)
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "blockquote.abstract"))
            )

            paper = _parse_abs_page(abs_url, driver.page_source, req.url, collected_at)
            if paper.get("abstract"):
                records.append(paper)

            # Keep visible browser movement understandable without making small crawls too slow.
            if req.delay_per_paper:
                time.sleep(req.delay_per_paper)

        return records

    finally:
        # Browser remains visible during crawling, then closes after the API finishes.
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass


@router.post("/collect")
def collect_arxiv_abstracts(req: ArxivCollectRequest):
    records = _collect_with_selenium(req)

    if not records:
        raise HTTPException(status_code=404, detail="No abstracts were collected.")

    csv_path = _save_csv(records, req.url)
    preview_limit = min(50, len(records))

    return {
        "success": True,
        "requested": req.max_papers,
        "collected": len(records),
        "source_url": req.url,
        "csv_filename": csv_path.name,
        "csv_path": str(csv_path),
        "download_url": f"/api/arxiv/download/{csv_path.name}",
        "preview_limit": preview_limit,
        "papers": records[:preview_limit],
    }


@router.get("/download/{filename}")
def download_arxiv_csv(filename: str):
    safe_name = Path(filename).name
    path = (_output_dir() / safe_name).resolve()
    root = _output_dir().resolve()

    if not str(path).startswith(str(root)) or not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="CSV file not found.")

    return FileResponse(path, media_type="text/csv", filename=safe_name)
