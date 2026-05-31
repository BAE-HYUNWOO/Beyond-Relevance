# ========================================================================================================
# input
# ========================================================================================================
# DATA_COLLECTION_TOPICS = ["Econometrics", "Reinforcement Learning"]
# COLLECTION_DATE_TAG = "20260523"
# RUN_GOOGLE_SCHOLAR = True
# RUN_SCOPUS = False
# RUN_WOS = False
# MAX_TITLES_PER_TOPIC = 100
# HEADLESS_BROWSER = False
# SKIP_EXISTING_FILES = True
# SELENIUM_WAIT_TIME = 30

# ========================================================================================================
# output
# ========================================================================================================
# data/raw/ir_outputs/original_titles/
# ├── Google Scholar_Econometrics_20260523.csv
# ├── Scopus_Econometrics_20260523.csv
# └── Web of Science_Econometrics_20260523.csv
#
# Google Scholar columns:
# title, DOI, authors, year, google scholar meta
#
# Scopus/WOS columns:
# title, DOI

# ========================================================================================================
# run
# ========================================================================================================
# python scripts/run_ir_collection.py


import os, re, time, random, pyperclip, pandas as pd
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from src.config.settings import (
    DATA_COLLECTION_TOPICS,
    COLLECTION_DATE_TAG,
    RUN_GOOGLE_SCHOLAR,
    RUN_SCOPUS,
    RUN_WOS,
    MAX_TITLES_PER_TOPIC,
    HEADLESS_BROWSER,
    SKIP_EXISTING_FILES,
    SELENIUM_WAIT_TIME,
)

DATA_COLLECTION_TOPICS = (
    [os.getenv("IR_QUERY", "").strip()]
    if os.getenv("IR_QUERY", "").strip()
    else DATA_COLLECTION_TOPICS
)

COLLECTION_DATE_TAG = os.getenv("COLLECTION_DATE_TAG", COLLECTION_DATE_TAG)

RUN_GOOGLE_SCHOLAR = (
    os.getenv("RUN_GOOGLE_SCHOLAR", str(RUN_GOOGLE_SCHOLAR)).lower() == "true"
)
RUN_SCOPUS = os.getenv("RUN_SCOPUS", str(RUN_SCOPUS)).lower() == "true"
RUN_WOS = os.getenv("RUN_WOS", str(RUN_WOS)).lower() == "true"

MAX_TITLES_PER_TOPIC = int(os.getenv("MAX_TITLES_PER_TOPIC", MAX_TITLES_PER_TOPIC))
HEADLESS_BROWSER = (
    os.getenv("HEADLESS_BROWSER", str(HEADLESS_BROWSER)).lower() == "true"
)
SKIP_EXISTING_FILES = (
    os.getenv("SKIP_EXISTING_FILES", str(SKIP_EXISTING_FILES)).lower() == "true"
)

GOOGLE_SCHOLAR_HL = os.getenv("GOOGLE_SCHOLAR_HL", "en")
GOOGLE_SCHOLAR_LR = os.getenv("GOOGLE_SCHOLAR_LR", "lang_en")
CHROME_LANG = os.getenv("CHROME_LANG", "en-US")
ORIGINAL_DIR = "data/raw/ir_outputs/original_titles"
FOUND_DIR = "data/raw/ir_outputs/found_titles"
NOTFOUND_DIR = "data/raw/ir_outputs/not_found_titles"
FIXED_TITLES_FILE, NOT_EXISTING_FILE, DATASET_FILE = (
    "Title_Filter.csv",
    "not_existing.txt",
    "Papers_Dataset.csv",
)
BASE_DIR = Path(ORIGINAL_DIR)
MERGED_OUT = os.path.abspath("Systems_Distribution.csv")
SYSTEM_FILE = "Systems_Distribution.csv"
TEMPERATURE, MAX_RETRIES, SLEEP_BETWEEN_CALLS, SLEEP, BACKOFF_FACTOR = 0.1, 3, 1, 1, 2
MAX_FOUND_PER_FILE = 100
MAX_OUTPUT_TOKENS = 8192
(
    OPENALEX_SIM_THRESHOLD,
    SEMANTIC_SIM_THRESHOLD,
    CROSSREF_SIM_THRESHOLD,
    GOOGLE_SCHOLAR_SIM_THRESHOLD,
) = (0.92, 0.92, 0.90, 0.90)

GOOGLE_SCHOLAR_BASE, WEB_OF_SCIENCE_BASE, SCOPUS_BASE = (
    f"https://scholar.google.com/?hl={GOOGLE_SCHOLAR_HL}",
    "https://webofscience.clarivate.cn/wos/woscc/basic-search",
    "https://www.scopus.com/search/form.uri?display=basic",
)
CHROME_DRIVER_PATH = None
USE_MANUAL_CAPTCHA_WAIT = True
OPENALEX_BASE, SEMANTIC_BASE, CROSSREF_BASE = (
    "https://api.openalex.org/works",
    "https://api.semanticscholar.org/graph/v1/paper/search",
    "https://api.crossref.org/works",
)


def clean_title(text):
    return re.sub(r"\s+", " ", str(text)).strip()

def normalize_title(text):
    text = str(text or "").lower().strip()
    text = text.replace("–", "-").replace("—", "-")
    text = re.sub(r"[^\w\s-]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()
def safe_name(x):
    return re.sub(r'[\\/:*?"<>|]+', "_", str(x)).strip()


def human_sleep(a=1.2, b=2.8):
    time.sleep(random.uniform(a, b))


def clean_doi(x):
    x = clean_title(x)
    x = re.sub(r"^https?://(dx\.)?doi\.org/", "", x, flags=re.I)
    m = re.search(r"10\.\d{4,9}/\S+", x)
    return m.group(0).rstrip(".,;") if m else ""


def xpath_literal(s):
    if "'" not in s:
        return f"'{s}'"
    if '"' not in s:
        return f'"{s}"'
    return "concat(" + ', "\'", '.join(f"'{p}'" for p in s.split("'")) + ")"


def build_driver(HEADLESS_BROWSER=False, driver_path=None):
    options = webdriver.ChromeOptions()

    for x in [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--lang=" + CHROME_LANG,
    ]:
        options.add_argument(x)

    options.add_experimental_option("prefs", {"intl.accept_languages": CHROME_LANG})
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    if HEADLESS_BROWSER:
        options.add_argument("--headless=new")

    driver = (
        webdriver.Chrome(service=Service(driver_path), options=options)
        if driver_path
        else webdriver.Chrome(options=options)
    )

    driver.execute_script(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
    )

    driver.set_window_size(900, 650)
    driver.set_window_position(0, 420)

    return driver


def make_output_file(base_dir, query_word, system_name, COLLECTION_DATE_TAG, ext="csv"):
    folder = Path(base_dir)
    folder.mkdir(parents=True, exist_ok=True)
    return (
        folder
        / f"{safe_name(system_name)}_{safe_name(query_word)}_{COLLECTION_DATE_TAG}.{ext}"
    )


def save_title_doi_csv(records, output_file):
    output_file = Path(output_file)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(records)
    for c in ["title", "DOI"]:
        if c not in df.columns:
            df[c] = ""
    df["title"] = df["title"].map(clean_title)
    df["DOI"] = df["DOI"].map(clean_doi)
    df = df[df["title"].astype(str).str.len() > 0][["title", "DOI"]].drop_duplicates(
        subset=["title"], keep="first"
    )
    df.to_csv(output_file, index=False, encoding="utf-8-sig")
    print(f"[SAVED CSV] {output_file} | rows={len(df)}")


def save_google_scholar_csv(records, output_file):
    output_file = Path(output_file)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(records)
    for c in ["title", "DOI", "authors", "year", "google scholar meta"]:
        if c not in df.columns:
            df[c] = ""
    df["title"] = df["title"].map(clean_title)
    df["DOI"] = df["DOI"].map(clean_doi)
    df["authors"] = df["authors"].map(clean_title)
    df["google scholar meta"] = df["google scholar meta"].map(clean_title)
    df = df[df["title"].astype(str).str.len() > 0][
        ["title", "DOI", "authors", "year", "google scholar meta"]
    ].drop_duplicates(subset=["title"], keep="first")
    df.to_csv(output_file, index=False, encoding="utf-8-sig")
    print(f"[SAVED GS CSV] {output_file} | rows={len(df)}")


def wait_and_scroll_results(driver):
    try:
        WebDriverWait(driver, 8).until(
            lambda d: d.execute_script("return document.readyState")
            in ["interactive", "complete"]
        )
    except:
        pass
    driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    human_sleep(1, 2)


def maybe_handle_captcha(driver):
    txt = driver.page_source.lower()
    keys = [
        "unusual traffic",
        "not a robot",
        "captcha",
        "detected unusual traffic",
        "verify you are human",
        "i'm not a robot",
    ]
    if any(x in txt for x in keys):
        print("[WARN] Google Scholar CAPTCHA detected.")
        print("[ACTION] 브라우저에서 직접 인증하세요. 최대 2분 대기합니다.")
        if USE_MANUAL_CAPTCHA_WAIT:
            try:
                WebDriverWait(driver, 120).until(
                    lambda d: not any(k in d.page_source.lower() for k in keys)
                )
                print("[INFO] CAPTCHA cleared. Resume.")
            except:
                input("2분 경과 또는 자동감지 실패. 인증 완료 후 엔터: ")
        else:
            time.sleep(120)


# =========================================================
# Google Scholar title + authors + year
# =========================================================
def gs_open_and_login(driver):
    driver.get(GOOGLE_SCHOLAR_BASE)
    print("[READY] Google Scholar opened in English. Login/CAPTCHA if needed, then click Continue Crawling in the UI.")
    input(">> WAITING_FOR_CONTINUE_FROM_UI: ")
    maybe_handle_captcha(driver)


def gs_wait_results(driver, timeout=20):
    WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.ID, "gs_res_ccl_mid"))
    )


def gs_search_query(driver, query_word):
    query_word = clean_title(query_word)

    url = (
        "https://scholar.google.com/scholar?"
        + f"hl={GOOGLE_SCHOLAR_HL}&lr={GOOGLE_SCHOLAR_LR}&as_sdt=0%2C5&q="
        + query_word.replace(" ", "+")
    )

    driver.get(url)
    human_sleep(1.2, 2.0)


def gs_turn_off_include_citations(driver):
    xpath = "//li[contains(@class,'gs_inw')]//a[@role='checkbox'][.//span[contains(translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'include citations')]]"
    try:
        btn = WebDriverWait(driver, 8).until(
            EC.presence_of_element_located((By.XPATH, xpath))
        )
        state = (btn.get_attribute("aria-checked") or "").lower()

        if state != "true":
            print("[INFO] include citations already OFF")
            return

        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
        human_sleep(0.3, 0.8)

        try:
            btn.click()
        except:
            driver.execute_script("arguments[0].click();", btn)

        human_sleep(1.5, 2.5)

        def is_off(d):
            try:
                fresh = d.find_element(By.XPATH, xpath)
                return (fresh.get_attribute("aria-checked") or "").lower() == "false"
            except:
                return True

        WebDriverWait(driver, 8).until(is_off)
        print("[INFO] include citations -> OFF")

    except Exception as e:
        print(f"[WARN] include citations toggle skipped: {type(e).__name__}")


def gs_parse_meta(meta_text):
    meta_text = clean_title(meta_text)
    year = ""
    m = re.search(r"\b(19|20)\d{2}\b", meta_text)
    if m:
        year = int(m.group(0))
    left = meta_text.split(" - ")[0].strip()
    authors = []
    for a in re.split(r",\s*", left):
        a = clean_title(re.sub(r"\s+…$", "", a))
        if a and not a.startswith(("…", "...")):
            authors.append(a)
    return "; ".join(authors), year, meta_text


def gs_parse_records(driver):
    out = []
    for b in driver.find_elements(By.CSS_SELECTOR, "div.gs_ri"):
        try:
            title = clean_title(b.find_element(By.CSS_SELECTOR, "h3.gs_rt").text)
            title = re.sub(r"^\[.*?\]\s*", "", title).strip()
            if not title:
                continue
            try:
                meta = b.find_element(By.CSS_SELECTOR, "div.gs_a").text
            except:
                meta = ""
            authors, year, raw_meta = gs_parse_meta(meta)
            out.append(
                {
                    "title": title,
                    "DOI": "",
                    "authors": authors,
                    "year": year,
                    "google scholar meta": raw_meta,
                }
            )
        except:
            pass
    return out


def gs_click_next(driver):
    for by, val in [
        (By.LINK_TEXT, "Next"),
        (By.LINK_TEXT, "다음"),
        (By.CSS_SELECTOR, "button[aria-label='Next']"),
        (By.CSS_SELECTOR, "a[aria-label='Next']"),
    ]:
        try:
            driver.find_element(by, val).click()
            return True
        except:
            pass
    return False


def collect_google_scholar_records(driver, query_word, MAX_TITLES_PER_TOPIC):
    collected, seen = [], set()
    gs_search_query(driver, query_word)
    gs_wait_results(driver)
    maybe_handle_captcha(driver)
    gs_turn_off_include_citations(driver)
    gs_wait_results(driver)
    wait_and_scroll_results(driver)
    page = 1
    while len(collected) < MAX_TITLES_PER_TOPIC:
        print(f"\n=== Google Scholar | {query_word} | Page {page} ===")
        for r in gs_parse_records(driver):
            k = r["title"].lower().strip()
            if k not in seen:
                seen.add(k)
                collected.append(r)
                print(
                    f"{len(collected):03d}. {r['title']} | authors={r['authors']} | year={r['year']}"
                )
                if len(collected) >= MAX_TITLES_PER_TOPIC:
                    break
        if len(collected) >= MAX_TITLES_PER_TOPIC or not gs_click_next(driver):
            break
        gs_wait_results(driver)
        maybe_handle_captcha(driver)
        wait_and_scroll_results(driver)
        page += 1
    return collected[:MAX_TITLES_PER_TOPIC]


# =========================================================
# Web of Science title + DOI
# =========================================================
# WOS is less stable than Google Scholar because the page is an Angular app:
# - after the first query, the search input is often hidden/collapsed
# - the result list is virtualized, so ordinary page parsing misses records
# - the DOI copy menu is not always present or the aria-label may change
#
# This version uses three layers:
# 1) robust search-box activation + search button fallback
# 2) slow scrolling over the virtualized result list
# 3) DOI extraction by menu first, then detail-page regex fallback

def wos_open_and_login(driver, url=WEB_OF_SCIENCE_BASE):
    driver.get(url)
    print("[READY] Web of Science opened.")
    print("[ACTION] 로그인/기관 인증을 완료하고 Basic Search 화면이 보이면 계속하세요.")
    input(">> ENTER to start WOS crawling: ")


def wos_page_text(driver):
    try:
        return driver.find_element(By.TAG_NAME, "body").text
    except Exception:
        return ""


def wos_is_no_results_page(driver):
    text = wos_page_text(driver).lower()
    return any(
        key in text
        for key in [
            "no results found",
            "0 results",
            "没有找到",
            "未找到",
            "검색 결과가 없습니다",
        ]
    )


def wos_activate_search_box(driver):
    """Open/focus the WOS search field when the previous query already produced results."""
    candidates = [
        (By.CSS_SELECTOR, "div[data-ta='search-terms']"),
        (By.CSS_SELECTOR, "div.mdc-notched-outline"),
        (By.CSS_SELECTOR, "app-search-row"),
        (By.CSS_SELECTOR, "button[data-ta='edit-search']"),
        (By.XPATH, "//button[contains(., 'Edit') or contains(., 'Search') or contains(., '검색')]"),
    ]

    clicked = False
    for by, value in candidates:
        try:
            el = WebDriverWait(driver, 5).until(EC.presence_of_element_located((by, value)))
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
            human_sleep(0.4, 1.0)
            try:
                el.click()
            except Exception:
                driver.execute_script("arguments[0].click();", el)
            clicked = True
            human_sleep(0.8, 1.8)
            break
        except Exception:
            pass

    if not clicked:
        print("[WARN] WOS search box activation skipped; trying to locate input directly.")


def wos_find_search_input(driver):
    selectors = [
        "input[data-ta='search-criteria-input']",
        "input[aria-label*='Search']",
        "input[placeholder*='Search']",
        "textarea[data-ta='search-criteria-input']",
    ]

    last_error = None
    for css in selectors:
        try:
            return WebDriverWait(driver, 8).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, css))
            )
        except Exception as error:
            last_error = error

    raise last_error or RuntimeError("WOS search input not found")


def wos_submit_search(driver, box):
    """Submit by Enter first. If WOS ignores Enter, click the Search button."""
    try:
        box.send_keys(Keys.ENTER)
        human_sleep(1.5, 3.0)
        return
    except Exception:
        pass

    button_candidates = [
        (By.CSS_SELECTOR, "button[data-ta='run-search']"),
        (By.CSS_SELECTOR, "button[data-ta='search-button']"),
        (By.XPATH, "//button[contains(., 'Search') or contains(., '检索') or contains(., '검색')]"),
    ]

    for by, value in button_candidates:
        try:
            btn = WebDriverWait(driver, 8).until(EC.element_to_be_clickable((by, value)))
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
            human_sleep(0.4, 1.0)
            try:
                btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", btn)
            human_sleep(1.5, 3.0)
            return
        except Exception:
            pass

    raise RuntimeError("WOS search submit failed")


def wos_search_query(driver, query_word, reuse=False):
    if reuse:
        wos_activate_search_box(driver)

    box = wos_find_search_input(driver)
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", box)
    human_sleep(0.4, 1.0)

    try:
        box.click()
    except Exception:
        driver.execute_script("arguments[0].click();", box)

    human_sleep(0.3, 0.8)
    box.send_keys(Keys.CONTROL, "a")
    human_sleep(0.2, 0.5)
    box.send_keys(Keys.DELETE)
    human_sleep(0.4, 1.0)
    box.send_keys(query_word)
    human_sleep(0.8, 1.6)
    wos_submit_search(driver, box)


def wos_wait_results(driver):
    """Wait until either result titles or a no-result message appears."""
    title_selectors = [
        "a[data-ta='summary-record-title-link']",
        "app-summary-title a",
        "a[href*='/full-record/']",
        "a[href*='full-record']",
    ]

    def ready(d):
        if wos_is_no_results_page(d):
            return True
        for css in title_selectors:
            if d.find_elements(By.CSS_SELECTOR, css):
                return True
        return False

    WebDriverWait(driver, SELENIUM_WAIT_TIME).until(ready)
    human_sleep(2.0, 4.0)


def wos_extract_title_text(elem):
    for attr in [None, "textContent", "innerText", "aria-label", "title"]:
        try:
            text = elem.text if attr is None else elem.get_attribute(attr)
            t = clean_title(text)
            t = re.sub(r"^(Title|제목|标题)\s*[:：]\s*", "", t, flags=re.I)
            if t:
                return t
        except Exception:
            pass
    return ""


def wos_result_title_elements(driver):
    selectors = [
        "a[data-ta='summary-record-title-link']",
        "app-summary-title a",
        "a[href*='/full-record/']",
        "a[href*='full-record']",
    ]

    out = []
    seen = set()
    for css in selectors:
        for el in driver.find_elements(By.CSS_SELECTOR, css):
            try:
                title = wos_extract_title_text(el)
                href = el.get_attribute("href") or ""
                key = (title.lower().strip(), href)
                if title and key not in seen:
                    seen.add(key)
                    out.append(el)
            except Exception:
                pass

    return out


def wos_copy_doi_from_menu(driver, title):
    """Try the WOS three-dot/copy DOI menu only when the menu button is tied to this exact title.

    IMPORTANT: Do not fall back to generic //app-summary-record-options//button here.
    WOS virtual-list pages often keep old option buttons in the DOM, so a generic
    menu click can copy the DOI of the first/previous record and attach it to many
    different titles.
    """
    try:
        pyperclip.copy("")
    except Exception:
        pass

    title_lit = xpath_literal(title)
    menu_xpaths = [
        f"//app-summary-record-options//button[contains(@aria-label,{title_lit})]",
        f"//button[contains(@aria-label,{title_lit}) and (contains(@aria-label,'DOI') or contains(@aria-label,'Export') or contains(@aria-label,'options') or contains(@aria-label,'Options') or contains(@aria-label,'More'))]",
    ]

    for xp in menu_xpaths:
        try:
            btns = driver.find_elements(By.XPATH, xp)
            for btn in btns:
                try:
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                    human_sleep(0.25, 0.7)
                    try:
                        btn.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", btn)
                    human_sleep(0.5, 1.0)

                    doi_btns = driver.find_elements(
                        By.XPATH,
                        "//button[@role='menuitem'][.//span[normalize-space()='DOI'] or contains(., 'DOI')]"
                    )
                    if not doi_btns:
                        try:
                            driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                        except Exception:
                            pass
                        continue

                    try:
                        doi_btns[0].click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", doi_btns[0])
                    human_sleep(0.5, 1.2)

                    doi = clean_doi(pyperclip.paste())
                    try:
                        driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                    except Exception:
                        pass

                    if doi:
                        return doi
                except Exception:
                    try:
                        driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                    except Exception:
                        pass
        except Exception:
            pass

    return ""


def wos_extract_doi_from_detail_page(driver, title_elem):
    """Fallback: open the record detail page and regex the DOI from body text."""
    list_url = driver.current_url
    doi = ""

    try:
        href = title_elem.get_attribute("href") or ""
        if href:
            driver.execute_script("window.open(arguments[0], '_blank');", href)
            driver.switch_to.window(driver.window_handles[-1])
        else:
            try:
                title_elem.click()
            except Exception:
                driver.execute_script("arguments[0].click();", title_elem)

        WebDriverWait(driver, SELENIUM_WAIT_TIME).until(
            lambda d: d.execute_script("return document.readyState") in ["interactive", "complete"]
        )
        human_sleep(2.0, 4.0)

        body_text = wos_page_text(driver)

        # Prefer DOI patterns close to a DOI label. A detail page can contain
        # many unrelated DOI-like strings in recommendations/cited references.
        label_match = re.search(
            r"\bDOI\b\s*[:：]?\s*(10\.\d{4,9}/[^\s\"'<>()]+)",
            body_text,
            flags=re.I,
        )
        if label_match:
            doi = clean_doi(label_match.group(1))
        else:
            doi = clean_doi(body_text)

    except Exception as error:
        print(f"[WARN] WOS detail DOI fallback failed: {type(error).__name__}")
    finally:
        try:
            if len(driver.window_handles) > 1:
                driver.close()
                driver.switch_to.window(driver.window_handles[0])
            elif driver.current_url != list_url:
                driver.get(list_url)
                wos_wait_results(driver)
        except Exception:
            pass

    return doi


def wos_copy_doi_for_title(driver, title, title_elem=None):
    # Detail page first: list-page copy menus are easy to desync on WOS virtual scrolling.
    if title_elem is not None:
        doi = wos_extract_doi_from_detail_page(driver, title_elem)
        if doi:
            return doi

    # Exact-title menu fallback only. No generic menu fallback.
    doi = wos_copy_doi_from_menu(driver, title)
    if doi:
        return doi

    return ""


def wos_collect_visible_title_doi(driver, collected, seen, MAX_TITLES_PER_TOPIC):
    elems = wos_result_title_elements(driver)
    added = 0

    # Track DOI -> title inside this run. If the same DOI is suddenly copied
    # for unrelated titles, it is almost certainly a stale clipboard/menu result.
    doi_to_title = {clean_doi(r.get("DOI", "")): r.get("title", "") for r in collected if clean_doi(r.get("DOI", ""))}

    for e in elems:
        title = wos_extract_title_text(e)
        key = title.lower().strip()

        if not title or key in seen:
            continue

        seen.add(key)
        doi = wos_copy_doi_for_title(driver, title, title_elem=e)

        if doi and doi in doi_to_title and normalize_title(doi_to_title[doi]) != normalize_title(title):
            print(f"[WARN] WOS duplicated DOI discarded: {doi} | current={title} | previous={doi_to_title[doi]}")
            doi = ""

        if doi:
            doi_to_title[doi] = title

        collected.append({"title": title, "DOI": doi})
        added += 1

        print(f"{len(collected):03d}. {title} | DOI={doi}")

        if len(collected) >= MAX_TITLES_PER_TOPIC:
            break

    return added


def wos_scroll_container(driver, step):
    """Scroll both the page and likely virtual-scroll containers."""
    driver.execute_script(
        """
        window.scrollBy(0, arguments[0]);
        const candidates = Array.from(document.querySelectorAll(
          'cdk-virtual-scroll-viewport, .cdk-virtual-scroll-viewport, [class*="scroll"], [class*="Scroll"]'
        ));
        for (const el of candidates) {
          try { el.scrollTop = el.scrollTop + arguments[0]; } catch (e) {}
        }
        """,
        step,
    )


def wos_slow_scroll_and_collect(
    driver, collected, seen, MAX_TITLES_PER_TOPIC, step=420, max_rounds=90
):
    print("[INFO] WOS start slow scroll collecting")
    stable_rounds = 0
    last_total = len(collected)
    last_height = driver.execute_script("return document.body.scrollHeight")

    added = wos_collect_visible_title_doi(driver, collected, seen, MAX_TITLES_PER_TOPIC)
    print(f"[INFO] WOS initial added={added} total={len(collected)}")

    for i in range(max_rounds):
        if len(collected) >= MAX_TITLES_PER_TOPIC:
            break

        wos_scroll_container(driver, step)
        human_sleep(1.2, 3.0)

        added1 = wos_collect_visible_title_doi(driver, collected, seen, MAX_TITLES_PER_TOPIC)
        human_sleep(0.5, 1.4)
        added2 = wos_collect_visible_title_doi(driver, collected, seen, MAX_TITLES_PER_TOPIC)

        new_height = driver.execute_script("return document.body.scrollHeight")
        total_added = added1 + added2

        print(
            f"[WOS SCROLL] round={i+1} | height={new_height} | added={total_added} | total={len(collected)}"
        )

        if len(collected) == last_total and new_height == last_height:
            stable_rounds += 1
        else:
            stable_rounds = 0

        last_total = len(collected)
        last_height = new_height

        if stable_rounds >= 5:
            print("[INFO] WOS no new records -> likely bottom")
            break

    for _ in range(3):
        if len(collected) >= MAX_TITLES_PER_TOPIC:
            break
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        wos_scroll_container(driver, step * 2)
        human_sleep(1.8, 3.8)
        added = wos_collect_visible_title_doi(driver, collected, seen, MAX_TITLES_PER_TOPIC)
        print(f"[INFO] WOS final bottom pass added={added} total={len(collected)}")


def wos_click_next(driver):
    next_candidates = [
        (By.CSS_SELECTOR, "button[data-ta='next-page-button']"),
        (By.CSS_SELECTOR, "button[aria-label*='Next']"),
        (By.XPATH, "//button[contains(., 'Next') or contains(., '下一页') or contains(., '다음')]"),
    ]

    for by, value in next_candidates:
        try:
            btn = WebDriverWait(driver, 8).until(EC.presence_of_element_located((by, value)))
            disabled = (
                btn.get_attribute("disabled")
                or btn.get_attribute("aria-disabled")
                or ""
            ).lower()
            if disabled in ["true", "disabled"]:
                continue

            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
            human_sleep(0.8, 2.0)

            try:
                btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", btn)

            human_sleep(2.5, 5.0)
            return True
        except Exception:
            pass

    print("[WARN] WOS next click failed")
    return False


def collect_wos_title_doi_records(
    driver, query_word, MAX_TITLES_PER_TOPIC, reuse_search=False
):
    collected, seen = [], set()

    wos_search_query(driver, query_word, reuse=reuse_search)
    wos_wait_results(driver)

    if wos_is_no_results_page(driver):
        print(f"[WARN] WOS no results: {query_word}")
        return []

    page = 1

    while len(collected) < MAX_TITLES_PER_TOPIC:
        print(f"\n=== Web of Science | {query_word} | Page {page} ===")

        before = len(collected)
        wos_slow_scroll_and_collect(
            driver,
            collected,
            seen,
            MAX_TITLES_PER_TOPIC,
            step=420,
            max_rounds=90,
        )

        print(f"[INFO] WOS page {page} added={len(collected)-before} total={len(collected)}")

        if len(collected) >= MAX_TITLES_PER_TOPIC:
            break

        moved = wos_click_next(driver)
        print(f"[INFO] WOS next page clicked? {moved}")

        if not moved:
            break

        wos_wait_results(driver)
        page += 1

    return collected[:MAX_TITLES_PER_TOPIC]


# =========================================================
# Scopus title + DOI
# =========================================================
def scopus_open_and_login(driver, url=SCOPUS_BASE):
    driver.get(url)
    input("Scopus 로그인 후 엔터: ")


def scopus_search_query(driver, query_word):
    box = WebDriverWait(driver, SELENIUM_WAIT_TIME).until(
        EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "input[id*='autosuggest'][id$='-input']")
        )
    )
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", box)
    human_sleep(0.5, 1)
    box.click()
    box.send_keys(Keys.CONTROL, "a")
    box.send_keys(Keys.DELETE)
    box.send_keys(query_word)
    box.send_keys(Keys.ENTER)


def scopus_wait_results(driver):
    """Wait for Scopus results with multiple selector fallbacks.

    Scopus changes its DOM classes frequently. The old code only waited for
    TableItems-module classes, which causes TimeoutException when Scopus renders
    the newer result list or when the page is already loaded but uses different
    attributes. This function accepts several reliable signals and prints debug
    info if waiting fails.
    """
    selectors = [
        "td.TableItems-module__UF1E0",
        "div.TableItems-module__sHEzP",
        "a[href*='/pages/publications/']",
        "a[href*='record/display.uri']",
        "a[href*='eid=']",
        "h3 a",
        "[data-testid*='document-title']",
        "[data-testid*='results-list']",
        "table tbody tr",
    ]

    def has_results(d):
        try:
            ready_state = d.execute_script("return document.readyState")
            if ready_state not in ["interactive", "complete"]:
                return False

            body_text = d.find_element(By.TAG_NAME, "body").text.lower()

            result_markers = [
                "documents found",
                "results",
                "sort by",
                "document search results",
                "search results",
                "export",
                "view abstract",
            ]

            if any(marker in body_text for marker in result_markers):
                return True

            for css in selectors:
                if d.find_elements(By.CSS_SELECTOR, css):
                    return True

            return False
        except Exception:
            return False

    try:
        WebDriverWait(driver, SELENIUM_WAIT_TIME).until(has_results)
        print("[INFO] Scopus results detected")
        print(f"[INFO] Scopus current url: {driver.current_url}")
        print(f"[INFO] Scopus page title: {driver.title}")
        human_sleep(2, 4)
    except Exception as e:
        print(f"[ERROR] Scopus wait results failed: {type(e).__name__}")
        print(f"[DEBUG] Scopus current url: {driver.current_url}")
        print(f"[DEBUG] Scopus page title: {driver.title}")
        try:
            body_text = driver.find_element(By.TAG_NAME, "body").text
            print("[DEBUG] Scopus body preview:")
            print(body_text[:1200])
        except Exception:
            pass
        raise


def scopus_click_page1(driver):
    try:
        btn = WebDriverWait(driver, SELENIUM_WAIT_TIME).until(
            EC.element_to_be_clickable(
                (By.XPATH, "//li[.//button[.//span[normalize-space()='1']]]//button")
            )
        )
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
        human_sleep(0.5, 1)
        driver.execute_script("arguments[0].click();", btn)
        human_sleep(1, 2)
        return True
    except Exception as e:
        print(f"[WARN] page 1 button click failed: {e}")
        return False


def scopus_set_sort_relevance(driver):
    try:
        select_el = WebDriverWait(driver, SELENIUM_WAIT_TIME).until(
            EC.presence_of_element_located(
                (
                    By.CSS_SELECTOR,
                    "div.document-sort-selector select.Select-module__vDMww",
                )
            )
        )
        driver.execute_script(
            "arguments[0].scrollIntoView({block:'center'});", select_el
        )
        human_sleep(0.8, 1.5)
        Select(select_el).select_by_value("r-f")
        human_sleep(2, 4)
        scopus_wait_results(driver)
        print("[INFO] Scopus sort -> Relevance")
        return True
    except Exception as e:
        print(f"[WARN] Scopus sort relevance failed: {e}")
        return False


def scopus_parse_title_links(driver):
    out = []
    selectors = [
        "td.TableItems-module__UF1E0 h3 a",
        "div.TableItems-module__sHEzP h3 a",
        "a[href*='/pages/publications/']",
    ]
    seen = set()

    for css in selectors:
        for a in driver.find_elements(By.CSS_SELECTOR, css):
            try:
                title = clean_title(a.text)
                href = a.get_attribute("href") or ""
                if not title:
                    title = clean_title(a.get_attribute("textContent") or "")
                if not href:
                    raw = a.get_attribute("href") or ""
                    href = raw
                if href.startswith("/"):
                    href = "https://www.scopus.com" + href
                key = title.lower().strip()
                if title and href and key not in seen:
                    seen.add(key)
                    out.append({"title": title, "href": href})
            except:
                pass

    return out


def scopus_extract_doi_from_text(driver):
    try:
        txt = driver.find_element(By.TAG_NAME, "body").text
        return clean_doi(txt)
    except:
        return ""


def scopus_copy_doi_on_detail_page(driver):
    try:
        pyperclip.copy("")
    except:
        pass

    doi = scopus_extract_doi_from_text(driver)
    if doi:
        return doi

    buttons = driver.find_elements(
        By.XPATH, "//button[.//span[contains(normalize-space(.),'Copy to clipboard')]]"
    )

    if not buttons:
        buttons = driver.find_elements(
            By.CSS_SELECTOR,
            "button.Button_button__9XFW1, button[class*='Button_button']",
        )

    for btn in buttons:
        try:
            pyperclip.copy("")
        except:
            pass

        try:
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
            human_sleep(0.4, 1)
            try:
                btn.click()
            except:
                driver.execute_script("arguments[0].click();", btn)
            human_sleep(0.6, 1.3)

            doi = clean_doi(pyperclip.paste())
            if doi:
                return doi
        except:
            pass

    return ""


def scopus_collect_page_records(driver, collected, seen, MAX_TITLES_PER_TOPIC):
    title_links = scopus_parse_title_links(driver)
    added = 0

    for item in title_links:
        if len(collected) >= MAX_TITLES_PER_TOPIC:
            break

        title = item["title"]
        href = item["href"]
        key = title.lower().strip()

        if not title or key in seen:
            continue

        seen.add(key)
        list_url = driver.current_url
        doi = ""

        try:
            driver.get(href)
            WebDriverWait(driver, SELENIUM_WAIT_TIME).until(
                lambda d: d.execute_script("return document.readyState")
                in ["interactive", "complete"]
            )
            human_sleep(2, 4)
            doi = scopus_copy_doi_on_detail_page(driver)
        except Exception as e:
            print(f"[WARN] Scopus DOI failed: {type(e).__name__} | {title}")
        finally:
            try:
                driver.get(list_url)
                scopus_wait_results(driver)
            except:
                pass

        collected.append({"title": title, "DOI": doi})
        added += 1
        print(f"{len(collected):03d}. {title} | DOI={doi}")

    return added


def scopus_click_next(driver):
    try:
        cur = int(
            driver.find_element(
                By.CSS_SELECTOR, "button[aria-current='true']"
            ).text.strip()
        )
        btn = driver.find_element(By.XPATH, f"//button[span[text()='{cur+1}']]")
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
        human_sleep(0.5, 1)
        driver.execute_script("arguments[0].click();", btn)
        human_sleep(2, 4)
        return True
    except:
        return False


def collect_scopus_title_doi_records(driver, query_word, MAX_TITLES_PER_TOPIC):
    collected, seen = [], set()

    scopus_search_query(driver, query_word)
    scopus_wait_results(driver)
    scopus_set_sort_relevance(driver)
    scopus_click_page1(driver)
    scopus_wait_results(driver)
    wait_and_scroll_results(driver)

    page = 1
    while len(collected) < MAX_TITLES_PER_TOPIC:
        print(f"\n=== Scopus | {query_word} | Page {page} ===")

        before = len(collected)
        scopus_collect_page_records(driver, collected, seen, MAX_TITLES_PER_TOPIC)

        print(
            f"[INFO] Scopus page {page} added={len(collected)-before} total={len(collected)}"
        )

        if len(collected) >= MAX_TITLES_PER_TOPIC:
            break

        if not scopus_click_next(driver):
            break

        scopus_wait_results(driver)
        wait_and_scroll_results(driver)
        page += 1

    return collected[:MAX_TITLES_PER_TOPIC]


# =========================================================
# 실행
# =========================================================
def run_google_scholar_batch():
    if not RUN_GOOGLE_SCHOLAR:
        return
    pending = []
    for q in DATA_COLLECTION_TOPICS:
        out = make_output_file(
            BASE_DIR, q, "Google Scholar", COLLECTION_DATE_TAG, ext="csv"
        )
        if out.exists() and SKIP_EXISTING_FILES:
            print(f"[SKIP EXISTS] {out}")
        else:
            pending.append((q, out))
    if not pending:
        print("[INFO] Google Scholar: all files exist -> skip browser launch")
        return
    driver = build_driver(HEADLESS_BROWSER, CHROME_DRIVER_PATH)
    try:
        gs_open_and_login(driver)
        for q, out in pending:
            records = collect_google_scholar_records(driver, q, MAX_TITLES_PER_TOPIC)
            save_google_scholar_csv(records, out)
    finally:
        driver.quit()


def run_wos_batch():
    if not RUN_WOS:
        return
    pending = []
    for q in DATA_COLLECTION_TOPICS:
        out = make_output_file(
            BASE_DIR, q, "Web of Science", COLLECTION_DATE_TAG, ext="csv"
        )
        if out.exists() and SKIP_EXISTING_FILES:
            print(f"[SKIP EXISTS] {out}")
        else:
            pending.append((q, out))
    if not pending:
        print("[INFO] WOS: all files already exist -> skip browser launch")
        return
    driver = build_driver(HEADLESS_BROWSER, CHROME_DRIVER_PATH)
    try:
        wos_open_and_login(driver)
        first = True
        for q, out in pending:
            records = collect_wos_title_doi_records(
                driver, q, MAX_TITLES_PER_TOPIC, reuse_search=not first
            )
            save_title_doi_csv(records, out)
            first = False
    finally:
        driver.quit()


def run_scopus_batch():
    if not RUN_SCOPUS:
        return

    pending = []
    for q in DATA_COLLECTION_TOPICS:
        out = make_output_file(BASE_DIR, q, "Scopus", COLLECTION_DATE_TAG, ext="csv")
        if out.exists() and SKIP_EXISTING_FILES:
            print(f"[SKIP EXISTS] {out}")
        else:
            pending.append((q, out))

    if not pending:
        print("[INFO] Scopus: all files exist -> skip browser launch")
        return

    driver = build_driver(HEADLESS_BROWSER, CHROME_DRIVER_PATH)
    try:
        scopus_open_and_login(driver)
        for q, out in pending:
            records = collect_scopus_title_doi_records(driver, q, MAX_TITLES_PER_TOPIC)
            save_title_doi_csv(records, out)
    finally:
        driver.quit()


def run_all_search_engines():
    run_google_scholar_batch()
    run_scopus_batch()
    run_wos_batch()


# =========================================================
# Main entry point for IR system collection
# =========================================================


def main():

    print("\n===== START: IR SYSTEM COLLECTION =====")

    if RUN_GOOGLE_SCHOLAR:
        print("\n===== START: Google Scholar =====")
        run_google_scholar_batch()

    if RUN_SCOPUS:
        print("\n===== START: Scopus =====")
        run_scopus_batch()

    if RUN_WOS:
        print("\n===== START: Web of Science =====")
        run_wos_batch()

    print("\n===== ALL DONE =====")


if __name__ == "__main__":

    try:

        print("[MAIN] START")

        main()

        print("[MAIN] DONE")

    except Exception as e:

        import traceback

        print("\n" + "=" * 80)
        print("[FATAL ERROR]")
        print("=" * 80)

        traceback.print_exc()

        print("=" * 80 + "\n")
