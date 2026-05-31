import os,re,glob,time,requests
import pandas as pd
from pathlib import Path
from difflib import SequenceMatcher
from datetime import datetime

import os

MAILTO = os.getenv("MAILTO", "bhwbhw0307@gmail.com")
OPENALEX_API_KEY = os.getenv("OPENALEX_API_KEY", "")
SEMANTIC_SCHOLAR_API_KEY = os.getenv("SEMANTIC_API_KEY", "")

BASE_DIR = Path(__file__).resolve().parents[2]
IR_OUTPUT_ROOT = Path(os.getenv("IR_OUTPUT_ROOT", BASE_DIR / "data" / "raw" / "ir_outputs"))
ORIGINAL_DIR = str(IR_OUTPUT_ROOT / "original_titles")
FOUND_DIR = str(IR_OUTPUT_ROOT / "found_titles")
NOTFOUND_DIR = str(IR_OUTPUT_ROOT / "not_found_titles")

DATASET_FILE = os.getenv(
    "PAPERS_DATASET_FILE",
    str(BASE_DIR / "data" / "dataset" / "papers_dataset.csv"),
)
ALL_NOT_FOUND_FILE = str(IR_OUTPUT_ROOT / "all_not_found_titles.txt")
FIXED_TITLES_FILE = os.getenv("TITLE_FILTER_FILE", str(IR_OUTPUT_ROOT / "Title_Filter.csv"))
NOT_EXISTING_FILE = os.getenv("NOT_EXISTING_FILE", str(IR_OUTPUT_ROOT / "not_existing.txt"))
MERGED_OUT = os.getenv("IR_SYSTEMS_DISTRIBUTION_FILE", str(IR_OUTPUT_ROOT / "Systems_Distribution.csv"))
IR_MATCH_INPUT_FILES = [x for x in os.getenv("IR_MATCH_INPUT_FILES", "").split(os.pathsep) if x]

IR_SYSTEMS=["Google Scholar","Scopus","Web of Science"]
MAX_FOUND_PER_FILE=100
MAX_RETRIES,SLEEP=3,1


OPENALEX_BASE="https://api.openalex.org/works"
SEMANTIC_BASE="https://api.semanticscholar.org/graph/v1/paper/search"
CROSSREF_BASE="https://api.crossref.org/works"


OPENALEX_SIM_THRESHOLD,SEMANTIC_SIM_THRESHOLD,CROSSREF_SIM_THRESHOLD=0.92,0.92,0.90
OPENALEX_SELECT_FIELDS=["id","doi","title","display_name","type","cited_by_count","publication_year","authorships","primary_location","open_access","topics","fwci","citation_normalized_percentile","referenced_works_count"]
SEMANTIC_FIELDS=["paperId","title","year","authors","venue","citationCount","referenceCount","externalIds","publicationVenue","fieldsOfStudy","openAccessPdf"]

OUTPUT_COLUMNS=["system","query word","query datetime","rank","dataset","openalex id","doi","title","year","type","source","publisher","authors","institutions","reference","cited by","fwci","citation percentile (by year/subfield)","primary topic","primary subfield","primary field","primary domain","is oa","open access status"]
DATASET_COLUMNS=[c for c in OUTPUT_COLUMNS if c not in ["system","query word","query datetime","rank"]]

def safe_name(t): return re.sub(r'[\\/:*?"<>|]+',"_",str(t)).strip()
def ensure_dir(p): Path(p).mkdir(parents=True,exist_ok=True)
def normalize_title(t):
    t=str(t).lower().strip().replace("–","-").replace("—","-")
    t=re.sub(r"[^\w\s-]"," ",t); t=re.sub(r"\s+"," ",t)
    return t.strip()
def similar(a,b): return SequenceMatcher(None,normalize_title(a),normalize_title(b)).ratio()
def clean_value(x):
    try:
        if x is None or pd.isna(x): return None
    except: pass
    x=str(x).strip()
    return x if x else None
def dedup_join(items):
    out=[]
    for x in items:
        if x is None: continue
        try:
            if isinstance(x,float) and pd.isna(x): continue
        except: pass
        x=str(x).strip()
        if x and x not in out: out.append(x)
    return "; ".join(out) if out else None
def clean_doi(x):
    try:
        if x is None or pd.isna(x): return ""
    except: pass
    x=str(x).strip()
    x=re.sub(r"^https?://(dx\.)?doi\.org/","",x,flags=re.I)
    m=re.search(r"10\.\d{4,9}/\S+",x)
    return m.group(0).rstrip(".,;") if m else ""
def clean_loaded_title(t):
    t=str(t).replace("\ufeff","").strip().strip('"').strip("'")
    t=re.sub(r"^\s*\d+\s*[\.\)\-:]+\s*","",t)
    t=re.sub(r"^\s*[\-\*\•]+\s*","",t)
    if "|" in t: t=t.split("|")[0].strip()
    t=re.sub(r"\([^)]*\)|\[[^\]]*\]|\{[^}]*\}"," ",t)
    t=re.sub(r"[\u4e00-\u9fff]+"," ",t)
    t=re.sub(r"\b\d+(st|nd|rd|th)\s+edition\b"," ",t,flags=re.I)
    t=re.sub(r"\bsecond edition\b"," ",t,flags=re.I)
    t=re.sub(r"\s+"," ",t).strip(" -_:;,.")
    return t
def save_lines_txt(path,lines):
    ensure_dir(os.path.dirname(path))
    with open(path,"w",encoding="utf-8") as f:
        for x in lines: f.write(str(x).rstrip()+"\n")
def align_columns(df,cols):
    for c in cols:
        if c not in df.columns: df[c]=None
    return df[cols]
def prepare_output_df(df): return align_columns(df,OUTPUT_COLUMNS)
def prepare_dataset_df(df): return align_columns(df,DATASET_COLUMNS)

def parse_original_filename(file):
    base=os.path.splitext(os.path.basename(file))[0]
    m=re.match(r"^(?P<system>Google Scholar|Scopus|Web of Science)_(?P<topic>.+?)_(?P<date>\d{8})(?:_(?P<time>\d{4}))?$",base)
    if not m: return {"source":base.split("_",1)[0],"topic":base.split("_",1)[1] if "_" in base else None,"query_datetime":None}
    if m.group("time"):
        qdt=datetime.strptime(f"{m.group('date')}_{m.group('time')}","%Y%m%d_%H%M").strftime("%Y-%m-%d %H:%M:%S")
    else:
        qdt=datetime.strptime(m.group("date"),"%Y%m%d").strftime("%Y-%m-%d")
    return {"source":m.group("system"),"topic":m.group("topic"),"query_datetime":qdt}

def get_output_paths(file):
    base=os.path.splitext(os.path.basename(file))[0]
    ensure_dir(FOUND_DIR); ensure_dir(NOTFOUND_DIR)
    return {"final_csv":os.path.join(FOUND_DIR,f"{base}_found.csv"),"not_found_txt":os.path.join(NOTFOUND_DIR,f"{base}_not_found.txt")}

def load_ir_records(file):
    file=Path(file); records=[]; seen=set()
    if file.suffix.lower()==".csv":
        df=pd.read_csv(file,encoding="utf-8-sig").fillna("")
        cmap={c.lower().strip():c for c in df.columns}
        title_col=cmap.get("title")
        doi_col=cmap.get("doi")
        if not title_col: raise ValueError(f"title column not found: {file}")
        for _,r in df.iterrows():
            t=clean_loaded_title(r.get(title_col,""))
            doi=clean_doi(r.get(doi_col,"")) if doi_col else ""
            nt=normalize_title(t)
            if t and nt not in seen:
                seen.add(nt); records.append({"title":t,"DOI":doi})
        out=pd.DataFrame(records)
        if len(out): out[["title","DOI"]].to_csv(file,index=False,encoding="utf-8-sig")
        return records
    with open(file,"r",encoding="utf-8-sig") as f:
        for line in f:
            t=clean_loaded_title(line.strip())
            nt=normalize_title(t)
            if t and nt not in seen:
                seen.add(nt); records.append({"title":t,"DOI":""})
    return records

def load_fix_map():
    if not os.path.exists(FIXED_TITLES_FILE): return {}
    df=pd.read_csv(FIXED_TITLES_FILE,encoding="utf-8-sig")
    return {normalize_title(o):f for o,f in zip(df["original_title"],df["fixed_title"])}

def load_not_existing():
    if not os.path.exists(NOT_EXISTING_FILE): return set()
    with open(NOT_EXISTING_FILE,"r",encoding="utf-8") as f:
        return {normalize_title(x.strip()) for x in f if x.strip()}

def load_all_not_found_titles():
    if not os.path.exists(ALL_NOT_FOUND_FILE): return set()
    with open(ALL_NOT_FOUND_FILE,"r",encoding="utf-8-sig") as f:
        return {normalize_title(x.strip()) for x in f if x.strip()}

def load_dataset_lookup():
    if not os.path.exists(DATASET_FILE): return {},pd.DataFrame(columns=DATASET_COLUMNS)
    df=pd.read_csv(DATASET_FILE,encoding="utf-8-sig")
    lookup={}
    if "title" in df.columns:
        for _,r in df.iterrows():
            k=normalize_title(r.get("title"))
            if k and k not in lookup: lookup[k]=r.to_dict()
    return lookup,df

def make_session(name):
    s=requests.Session()
    s.headers.update({"User-Agent":f"{name} ({MAILTO})"})
    return s

def request_with_retry(session,method,url,**kwargs):
    for i in range(MAX_RETRIES):
        try:
            r=session.request(method,url,timeout=25,**kwargs)
            if r.status_code==429:
                wait=int(r.headers.get("Retry-After",30)); print(f"[RATE LIMIT] wait={wait}s"); time.sleep(wait); continue
            if 500<=r.status_code<600:
                wait=min(2**i*5,60); print(f"[SERVER RETRY] status={r.status_code} wait={wait}s"); time.sleep(wait); continue
            r.raise_for_status(); return r
        except requests.exceptions.RequestException as e:
            wait=min(2**i*5,60); print(f"[REQUEST ERROR] wait={wait}s | {e}"); time.sleep(wait)
    return None

def build_dataset_row(title,row,file,rank):
    m=parse_original_filename(file); row=dict(row)
    row.update({"system":m["source"],"query word":m["topic"],"query datetime":m["query_datetime"],"rank":rank,"dataset":clean_value(row.get("dataset")) or "ExistingDataset"})
    return row

def build_openalex_row(title,w,file,rank):
    m=parse_original_filename(file); oa=w.get("open_access") or {}; cnp=w.get("citation_normalized_percentile") or {}
    authors=dedup_join([a.get("author",{}).get("display_name") for a in w.get("authorships",[]) if a.get("author",{}).get("display_name")])
    inst=dedup_join([i.get("display_name") for a in w.get("authorships",[]) for i in a.get("institutions",[]) if i.get("display_name")])
    src=(w.get("primary_location") or {}).get("source") or {}; topics=w.get("topics",[]) or [{}]
    top=max(topics,key=lambda x:x.get("score",-1)) if topics else {}
    return {"system":m["source"],"query word":m["topic"],"query datetime":m["query_datetime"],"rank":rank,"dataset":"OpenAlex","openalex id":w.get("id"),"doi":w.get("doi"),"title":w.get("title") or w.get("display_name"),"year":w.get("publication_year"),"type":w.get("type"),"source":src.get("display_name"),"publisher":src.get("host_organization_name"),"authors":authors,"institutions":inst,"reference":w.get("referenced_works_count"),"cited by":w.get("cited_by_count"),"fwci":w.get("fwci"),"citation percentile (by year/subfield)":cnp.get("value"),"primary topic":top.get("display_name"),"primary subfield":(top.get("subfield") or {}).get("display_name"),"primary field":(top.get("field") or {}).get("display_name"),"primary domain":(top.get("domain") or {}).get("display_name"),"is oa":oa.get("is_oa"),"open access status":oa.get("oa_status")}

def build_semantic_row(title,p,file,rank):
    m=parse_original_filename(file); ex=p.get("externalIds") or {}; doi=ex.get("DOI")
    if doi and not str(doi).lower().startswith("http"): doi=f"https://doi.org/{doi}"
    pv=p.get("publicationVenue") or {}
    return {"system":m["source"],"query word":m["topic"],"query datetime":m["query_datetime"],"rank":rank,"dataset":"Semantic Scholar","openalex id":None,"doi":doi,"title":p.get("title"),"year":p.get("year"),"type":None,"source":pv.get("name") or p.get("venue"),"publisher":pv.get("publisher"),"authors":dedup_join([a.get("name") for a in p.get("authors",[]) if a.get("name")]),"institutions":None,"reference":p.get("referenceCount"),"cited by":p.get("citationCount"),"fwci":None,"citation percentile (by year/subfield)":None,"primary topic":dedup_join(p.get("fieldsOfStudy") or []),"primary subfield":None,"primary field":None,"primary domain":None,"is oa":True if p.get("openAccessPdf") else None,"open access status":"open" if p.get("openAccessPdf") else None}

def build_crossref_row(title,p,file,rank):
    m=parse_original_filename(file); year=None
    for k in ["published-print","published-online","published"]:
        try:
            year=p.get(k,{}).get("date-parts",[[None]])[0][0]
            if year: break
        except: pass
    authors=[]
    for a in p.get("author",[]):
        nm=" ".join([str(a.get("given","")).strip(),str(a.get("family","")).strip()]).strip()
        if nm: authors.append(nm)
    doi=p.get("DOI")
    if doi: doi=f"https://doi.org/{doi}"
    return {"system":m["source"],"query word":m["topic"],"query datetime":m["query_datetime"],"rank":rank,"dataset":"Crossref","openalex id":None,"doi":doi,"title":p["title"][0] if p.get("title") else title,"year":year,"type":p.get("type"),"source":p.get("container-title",[None])[0] if p.get("container-title") else None,"publisher":p.get("publisher"),"authors":dedup_join(authors),"institutions":None,"reference":p.get("references-count"),"cited by":p.get("is-referenced-by-count"),"fwci":None,"citation percentile (by year/subfield)":None,"primary topic":None,"primary subfield":None,"primary field":None,"primary domain":None,"is oa":None,"open access status":None}

def search_openalex_by_doi(session,doi):
    if not doi: return None
    params={"mailto":MAILTO,"select":",".join(OPENALEX_SELECT_FIELDS)}
    if OPENALEX_API_KEY: params["api_key"]=OPENALEX_API_KEY
    r=request_with_retry(session,"GET",f"{OPENALEX_BASE}/doi:{doi}",params=params)
    return r.json() if r is not None else None

def search_semantic_by_doi(session,doi):
    if not doi: return None
    time.sleep(1.3)
    headers={"x-api-key":SEMANTIC_SCHOLAR_API_KEY} if SEMANTIC_SCHOLAR_API_KEY else {}
    r=request_with_retry(session,"GET",f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}",params={"fields":",".join(SEMANTIC_FIELDS)},headers=headers)
    return r.json() if r is not None else None

def search_crossref_by_doi(session,doi):
    if not doi: return None
    r=request_with_retry(session,"GET",f"{CROSSREF_BASE}/{doi}",params={"mailto":MAILTO})
    return r.json().get("message") if r is not None else None

def search_openalex(session,title):
    params={"search":title,"per_page":5,"mailto":MAILTO,"select":",".join(OPENALEX_SELECT_FIELDS)}
    if OPENALEX_API_KEY: params["api_key"]=OPENALEX_API_KEY
    r=request_with_retry(session,"GET",OPENALEX_BASE,params=params)
    if r is None: return None
    q=normalize_title(title); best,score=None,0
    for w in r.json().get("results",[]):
        c=w.get("display_name") or w.get("title") or ""; s=similar(q,c)
        if normalize_title(c)==q: return w
        if s>score: best,score=w,s
    return best if best and score>=OPENALEX_SIM_THRESHOLD else None

def search_semantic(session,title):
    time.sleep(1.3)
    headers={"x-api-key":SEMANTIC_SCHOLAR_API_KEY} if SEMANTIC_SCHOLAR_API_KEY else {}
    r=request_with_retry(session,"GET",SEMANTIC_BASE,params={"query":title,"limit":5,"fields":",".join(SEMANTIC_FIELDS)},headers=headers)
    if r is None: return None
    q=normalize_title(title); best,score=None,0
    for p in r.json().get("data",[]):
        c=p.get("title") or ""; s=similar(q,c)
        if normalize_title(c)==q: return p
        if s>score: best,score=p,s
    return best if best and score>=SEMANTIC_SIM_THRESHOLD else None

def search_crossref(session,title):
    r=request_with_retry(session,"GET",CROSSREF_BASE,params={"query.title":title,"rows":5,"mailto":MAILTO})
    if r is None: return None
    q=normalize_title(title); best,score=None,0
    for p in r.json().get("message",{}).get("items",[]):
        c=p["title"][0] if p.get("title") else ""; s=similar(q,c)
        if normalize_title(c)==q: return p
        if s>score: best,score=p,s
    return best if best and score>=CROSSREF_SIM_THRESHOLD else None

def search_and_merge_external(title,file,oa,ss,cr,fix,rank,doi="",use_semantic=True):
    doi=clean_doi(doi)
    if doi:
        row=search_openalex_by_doi(oa,doi)
        if row: return build_openalex_row(title,row,file,rank)
        if use_semantic:
            row=search_semantic_by_doi(ss,doi)
            if row: return build_semantic_row(title,row,file,rank)
        row=search_crossref_by_doi(cr,doi)
        if row: return build_crossref_row(title,row,file,rank)
    row=search_openalex(oa,title)
    if row: return build_openalex_row(title,row,file,rank)
    if use_semantic:
        row=search_semantic(ss,title)
        if row: return build_semantic_row(title,row,file,rank)
    row=search_crossref(cr,title)
    if row: return build_crossref_row(title,row,file,rank)
    fixed_title=fix.get(normalize_title(title))
    if fixed_title and normalize_title(fixed_title)!=normalize_title(title):
        row=search_openalex(oa,fixed_title)
        if row: return build_openalex_row(fixed_title,row,file,rank)
        if use_semantic:
            row=search_semantic(ss,fixed_title)
            if row: return build_semantic_row(fixed_title,row,file,rank)
        row=search_crossref(cr,fixed_title)
        if row: return build_crossref_row(fixed_title,row,file,rank)
    return None

def append_to_dataset_file(rows):
    if not rows: return
    ensure_dir(os.path.dirname(DATASET_FILE))
    new=prepare_dataset_df(pd.DataFrame(rows))
    old=pd.read_csv(DATASET_FILE,encoding="utf-8-sig") if os.path.exists(DATASET_FILE) else pd.DataFrame(columns=new.columns)
    for c in new.columns:
        if c not in old.columns: old[c]=None
    for c in old.columns:
        if c not in new.columns: new[c]=None
    df=pd.concat([old,new[old.columns]],ignore_index=True).drop_duplicates(subset=["title"],keep="first")
    df.to_csv(DATASET_FILE,index=False,encoding="utf-8-sig")

def merge_all_found_csvs():
    fs=glob.glob(os.path.join(FOUND_DIR,"*_found.csv"))
    if not fs: return
    df=pd.concat([pd.read_csv(x,encoding="utf-8-sig") for x in fs],ignore_index=True)
    df=df.drop_duplicates(subset=["system","query word","title"],keep="first")
    prepare_output_df(df).to_csv(MERGED_OUT,index=False,encoding="utf-8-sig")
    print(f"[MERGED FOUND] {len(df)} rows -> {MERGED_OUT}")

def merge_all_not_found_txts():
    fs=glob.glob(os.path.join(NOTFOUND_DIR,"*_not_found.txt")); seen,out=set(),[]
    for f in fs:
        with open(f,encoding="utf-8") as file:
            for x in file:
                x=x.strip(); nx=normalize_title(x)
                if x and nx not in seen:
                    seen.add(nx); out.append(x)
    save_lines_txt(ALL_NOT_FOUND_FILE,out)
    print(f"[MERGED NOT FOUND] {len(out)} titles -> {ALL_NOT_FOUND_FILE}")

def process_ir_file(file,lookup,oa,ss,cr,fix,not_exist,all_nf,use_semantic=True):
    p=get_output_paths(file)
    records=load_ir_records(file)
    rows=[]; nf=[]; seen=set()
    print(f"\n=== {os.path.basename(file)} | {len(records)} records ===")
    for i,r in enumerate(records,1):
        t=r["title"]; doi=clean_doi(r.get("DOI","")); nt=normalize_title(t); row=None; status=None
        if nt in not_exist:
            nf.append(t); print(f"{i}/{len(records)} [NOT EXISTING SKIP] {t}"); continue
        if nt in lookup:
            row=build_dataset_row(t,lookup[nt],file,i); status="DATASET FOUND"
            print(f"{i}/{len(records)} [DATASET FOUND] {t}")
        elif nt in all_nf and not doi:
            nf.append(t); print(f"{i}/{len(records)} [ALL NOT FOUND SKIP] {t}")
        else:
            row=search_and_merge_external(t,file,oa,ss,cr,fix,i,doi=doi,use_semantic=use_semantic)
            status="API FOUND" if row else None
        if row:
            rt=normalize_title(t)
            if rt not in seen:
                seen.add(rt); rows.append(row)
                if status!="DATASET FOUND": print(f"{i}/{len(records)} [API FOUND {len(rows)}] {t} | DOI={doi} | {row.get('dataset')}")
        else:
            if nt not in all_nf or doi:
                nf.append(t); print(f"{i}/{len(records)} [NOT FOUND {len(nf)}] {t} | DOI={doi}")
        if len(rows)>=MAX_FOUND_PER_FILE:
            print("[STOP] max reached"); break
        time.sleep(SLEEP)
    if rows:
        prepare_output_df(pd.DataFrame(rows)).to_csv(p["final_csv"],index=False,encoding="utf-8-sig")
        append_to_dataset_file(rows)
    save_lines_txt(p["not_found_txt"],nf)
    return {"rows":rows,"nf":nf}

def find_ir_original_files():
    if IR_MATCH_INPUT_FILES:
        selected=[]
        for name in IR_MATCH_INPUT_FILES:
            path = name if os.path.isabs(name) else os.path.join(ORIGINAL_DIR, name)
            if os.path.exists(path):
                selected.append(path)
            else:
                print(f"[WARN] selected IR file not found: {path}")
        return sorted(selected)

    files=[]
    for ext in ["*.txt","*.csv"]:
        for f in glob.glob(os.path.join(ORIGINAL_DIR,ext)):
            base=os.path.basename(f)
            if any(base.startswith(s+"_") for s in IR_SYSTEMS):
                files.append(f)
    return sorted(files)

def run_ir_systems_match(use_semantic=True,skip_if_found_exists=True):
    fix=load_fix_map(); not_exist=load_not_existing(); all_nf=load_all_not_found_titles(); lookup,_=load_dataset_lookup()
    oa=make_session("OpenAlexIRCollector/1.0"); ss=make_session("SemanticIRCollector/1.0"); cr=make_session("CrossrefIRCollector/1.0")
    try:
        files=find_ir_original_files()
        print(f"[IR FILES] {len(files)} files")
        for file in files:
            out=get_output_paths(file)["final_csv"]
            if skip_if_found_exists and os.path.exists(out):
                print(f"[SKIP FOUND EXISTS] {file}")
                continue
            process_ir_file(file,lookup,oa,ss,cr,fix,not_exist,all_nf,use_semantic=use_semantic)
        merge_all_found_csvs()
        merge_all_not_found_txts()
    finally:
        for s in [oa,ss,cr]:
            try: s.close()
            except: pass



if __name__ == "__main__":
    print("[MAIN] START IR MATCHING")
    run_ir_systems_match(use_semantic=True, skip_if_found_exists=False)
    print("[MAIN] DONE IR MATCHING")
