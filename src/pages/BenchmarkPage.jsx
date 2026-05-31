import React, { useEffect, useMemo, useState } from "react";
import "./BenchmarkPage.css";
import {
  chartData,
  outputChartData,
  makeComparisonData,
} from "../benchmark/chartUtils";

import { benchmark, fmt } from "../benchmark/metrics";
import { CompareTooltip } from "../components/benchmark/BenchmarkTooltips";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

import {
  DIMENSION_ORDER,
  CATEGORY_ORDER,
  CATEGORY_COLUMNS,
} from "../benchmark/constants";

import {
  parseCSV,
  getFileName,
  getQueryName,
  detectDims,
  findDim,
  aggregateSystemRows,
} from "../benchmark/csvUtils";

const csvFileLoaders = import.meta.glob(
  "../data/processed/real_world_distribution/*.csv",
  { query: "?raw", import: "default" }
);

const sampleSystemOutputFiles = import.meta.glob(
  "../data/sample_system_outputs/**/*",
  { query: "?raw", import: "default", eager: true }
);

const OPENALEX_BASE = "https://api.openalex.org/works";
const SEMANTIC_SEARCH_BASE = "https://api.semanticscholar.org/graph/v1/paper/search";
const CROSSREF_BASE = "https://api.crossref.org/works";
const CURRENT_YEAR = new Date().getFullYear();
const API_BASE = "http://127.0.0.1:8000";

const OUTPUT_COLUMNS = [
  "system",
  "query word",
  "query datetime",
  "rank",
  "dataset",
  "openalex id",
  "doi",
  "title",
  "year",
  "type",
  "source",
  "publisher",
  "authors",
  "institutions",
  "reference",
  "cited by",
  "fwci",
  "citation percentile (by year/subfield)",
  "primary topic",
  "primary subfield",
  "primary field",
  "primary domain",
  "is oa",
  "open access status",
];

const OPENALEX_SELECT_FIELDS = [
  "id",
  "doi",
  "title",
  "display_name",
  "type",
  "cited_by_count",
  "publication_year",
  "authorships",
  "primary_location",
  "open_access",
  "topics",
  "fwci",
  "citation_normalized_percentile",
  "referenced_works_count",
];

const SEMANTIC_FIELDS = [
  "paperId",
  "title",
  "year",
  "authors",
  "venue",
  "citationCount",
  "referenceCount",
  "externalIds",
  "publicationVenue",
  "fieldsOfStudy",
  "openAccessPdf",
];

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const m = x.length;
  const n = y.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return 1 - dp[m][n] / Math.max(m, n);
}

function dedupJoin(items) {
  const seen = [];
  (items || []).forEach((item) => {
    const value = String(item || "").trim();
    if (value && !seen.includes(value)) seen.push(value);
  });
  return seen.join("; ");
}

function cleanDoi(value) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  const match = cleaned.match(/10\.\d{4,9}\/\S+/i);
  return match ? match[0].replace(/[.,;]+$/, "") : "";
}

function csvEscape(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function getPreviewColumns(rows) {
  const extras = [];
  (rows || []).forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!OUTPUT_COLUMNS.includes(key) && !extras.includes(key)) extras.push(key);
    });
  });
  return [...OUTPUT_COLUMNS, ...extras];
}

function rowsToCsv(rows) {
  const columns = getPreviewColumns(rows);
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((col) => csvEscape(row[col])).join(",")),
  ].join("\n");
}

function downloadTextFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildOpenAlexRow(work, title, rank, queryWord) {
  const openAccess = work.open_access || {};
  const source = work.primary_location?.source || {};
  const topics = work.topics || [];
  const topTopic = topics.length
    ? [...topics].sort((a, b) => (b.score || 0) - (a.score || 0))[0]
    : {};
  const cnp = work.citation_normalized_percentile || {};

  return {
    "system": "Titles Input",
    "query word": queryWord || "",
    "query datetime": new Date().toISOString().slice(0, 19).replace("T", " "),
    rank,
    dataset: "OpenAlex",
    "openalex id": work.id || "",
    doi: work.doi || "",
    title: work.title || work.display_name || title,
    year: work.publication_year || "",
    type: work.type || "",
    source: source.display_name || "",
    publisher: source.host_organization_name || "",
    authors: dedupJoin((work.authorships || []).map((a) => a.author?.display_name)),
    institutions: dedupJoin(
      (work.authorships || []).flatMap((a) =>
        (a.institutions || []).map((i) => i.display_name)
      )
    ),
    reference: work.referenced_works_count || "",
    "cited by": work.cited_by_count || 0,
    fwci: work.fwci || "",
    "citation percentile (by year/subfield)": cnp.value || "",
    "primary topic": topTopic.display_name || "",
    "primary subfield": topTopic.subfield?.display_name || "",
    "primary field": topTopic.field?.display_name || "",
    "primary domain": topTopic.domain?.display_name || "",
    "is oa": openAccess.is_oa ?? "",
    "open access status": openAccess.oa_status || "",
  };
}

function buildSemanticRow(paper, title, rank, queryWord) {
  const externalIds = paper.externalIds || {};
  const doi = externalIds.DOI ? `https://doi.org/${externalIds.DOI}` : "";
  const venue = paper.publicationVenue || {};

  return {
    "system": "Titles Input",
    "query word": queryWord || "",
    "query datetime": new Date().toISOString().slice(0, 19).replace("T", " "),
    rank,
    dataset: "Semantic Scholar",
    "openalex id": "",
    doi,
    title: paper.title || title,
    year: paper.year || "",
    type: "",
    source: venue.name || paper.venue || "",
    publisher: venue.publisher || "",
    authors: dedupJoin((paper.authors || []).map((a) => a.name)),
    institutions: "",
    reference: paper.referenceCount || "",
    "cited by": paper.citationCount || 0,
    fwci: "",
    "citation percentile (by year/subfield)": "",
    "primary topic": dedupJoin(paper.fieldsOfStudy || []),
    "primary subfield": "",
    "primary field": "",
    "primary domain": "",
    "is oa": paper.openAccessPdf ? true : "",
    "open access status": paper.openAccessPdf ? "open" : "",
  };
}

function buildCrossrefRow(item, title, rank, queryWord) {
  let year = "";
  ["published-print", "published-online", "published", "issued"].some((key) => {
    year = item[key]?.["date-parts"]?.[0]?.[0] || "";
    return Boolean(year);
  });

  return {
    "system": "Titles Input",
    "query word": queryWord || "",
    "query datetime": new Date().toISOString().slice(0, 19).replace("T", " "),
    rank,
    dataset: "Crossref",
    "openalex id": "",
    doi: item.DOI ? `https://doi.org/${item.DOI}` : "",
    title: item.title?.[0] || title,
    year,
    type: item.type || "",
    source: item["container-title"]?.[0] || "",
    publisher: item.publisher || "",
    authors: dedupJoin(
      (item.author || []).map((a) => `${a.given || ""} ${a.family || ""}`.trim())
    ),
    institutions: "",
    reference: item["references-count"] || "",
    "cited by": item["is-referenced-by-count"] || 0,
    fwci: "",
    "citation percentile (by year/subfield)": "",
    "primary topic": "",
    "primary subfield": "",
    "primary field": "",
    "primary domain": "",
    "is oa": "",
    "open access status": "",
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function searchOpenAlex(title, apiKey, rank, queryWord) {
  const params = new URLSearchParams({
    search: title,
    per_page: "5",
    select: OPENALEX_SELECT_FIELDS.join(","),
  });
  if (apiKey) params.set("api_key", apiKey);

  const data = await fetchJson(`${OPENALEX_BASE}?${params.toString()}`);
  let best = null;
  let bestScore = 0;

  (data.results || []).forEach((work) => {
    const candidate = work.title || work.display_name || "";
    const score = similarity(title, candidate);
    if (score > bestScore) {
      best = work;
      bestScore = score;
    }
  });

  return best && bestScore >= 0.92
    ? buildOpenAlexRow(best, title, rank, queryWord)
    : null;
}

async function searchSemantic(title, apiKey, rank, queryWord) {
  const params = new URLSearchParams({
    query: title,
    limit: "5",
    fields: SEMANTIC_FIELDS.join(","),
  });
  const headers = apiKey ? { "x-api-key": apiKey } : {};

  const data = await fetchJson(`${SEMANTIC_SEARCH_BASE}?${params.toString()}`, { headers });
  let best = null;
  let bestScore = 0;

  (data.data || []).forEach((paper) => {
    const score = similarity(title, paper.title || "");
    if (score > bestScore) {
      best = paper;
      bestScore = score;
    }
  });

  return best && bestScore >= 0.92
    ? buildSemanticRow(best, title, rank, queryWord)
    : null;
}

async function searchCrossref(title, rank, queryWord) {
  const params = new URLSearchParams({
    "query.title": title,
    rows: "5",
  });
  const data = await fetchJson(`${CROSSREF_BASE}?${params.toString()}`);
  let best = null;
  let bestScore = 0;

  (data.message?.items || []).forEach((item) => {
    const candidate = item.title?.[0] || "";
    const score = similarity(title, candidate);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });

  return best && bestScore >= 0.9
    ? buildCrossrefRow(best, title, rank, queryWord)
    : null;
}

function getNumericValue(row) {
  const keys = ["value", "count", "ratio", "share", "percent", "percentage", "p"];
  for (const key of keys) {
    const n = Number(row?.[key]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function getNameValue(row) {
  return String(row?.name ?? row?.label ?? row?.bucket ?? row?.category ?? row?.year ?? "");
}

function normalizeChartRows(rows, activeDimension) {
  const data = (rows || []).map((row) => ({
    ...row,
    name: getNameValue(row),
    value: getNumericValue(row),
  }));

  if (activeDimension?.dimension === "year") {
    return data
      .filter((row) => {
        const year = Number(row.name);
        return Number.isFinite(year) && year <= CURRENT_YEAR;
      })
      .sort((a, b) => Number(b.name) - Number(a.name));
  }

  return data;
}

function yearTickFormatter(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return value;
  if (year === CURRENT_YEAR) return String(year);
  if (year === CURRENT_YEAR - 1) return String(year);
  if (year % 5 === 0) return String(year);
  return "";
}

function ChartCard({ title, data, active, barFill, rightControl }) {
  const chartRows = normalizeChartRows(data, active);
  const isYear = active?.dimension === "year";

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.78)",
        borderRadius: 28,
        padding: 24,
        border: "1px solid rgba(226,232,240,0.9)",
        boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 900 }}>{title}</div>
        {rightControl}
      </div>

      <div style={{ width: "100%", height: 300 }}>
        {chartRows.length > 0 ? (
          <ResponsiveContainer>
            <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 42 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                angle={isYear ? -32 : -35}
                textAnchor="end"
                height={isYear ? 82 : 100}
                interval={0}
                tickFormatter={isYear ? yearTickFormatter : undefined}
                tick={{ fill: "#334155", fontSize: 11 }}
              />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill={barFill} minPointSize={2} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#94a3b8",
              border: "1px dashed #cbd5e1",
              borderRadius: 18,
              background: "rgba(248,250,252,0.7)",
            }}
          >
            No chart data yet.
          </div>
        )}
      </div>
    </div>
  );
}

export default function BenchmarkPage() {
  const sampleFolders = useMemo(() => {
    const folders = {};
    Object.entries(sampleSystemOutputFiles).forEach(([path, raw]) => {
      const parts = path.split("/sample_system_outputs/")[1]?.split("/");
      if (!parts || parts.length < 2) return;
      const folderName = parts[0];
      const fileName = parts.slice(1).join("/");
      if (!folders[folderName]) folders[folderName] = { label: folderName, folderName, files: {} };
      folders[folderName].files[fileName] = raw;
    });
    return Object.values(folders);
  }, []);

  const [datasets, setDatasets] = useState([]);
  const [loadingRealDist, setLoadingRealDist] = useState(true);
  const [loadingAuthors, setLoadingAuthors] = useState(false);
  const [loadMessage, setLoadMessage] = useState("");
  const [selectedQuery, setSelectedQuery] = useState("");
  const [selectedSystem, setSelectedSystem] = useState(null);
  const [selectedDimension, setSelectedDimension] = useState("");
  const [uploadedSystems, setUploadedSystems] = useState([]);
  const [bench, setBench] = useState([]);
  const [selectedDetail, setSelectedDetail] = useState(null);

  const [titleInput, setTitleInput] = useState("");
  const [inputMode, setInputMode] = useState("titles");
  const [csvInputRows, setCsvInputRows] = useState([]);
  const [csvInputSystems, setCsvInputSystems] = useState([]);
  const [csvInputFileName, setCsvInputFileName] = useState("");
  const [csvDragging, setCsvDragging] = useState(false);
  const [openAlexApiKey, setOpenAlexApiKey] = useState("");
  const [semanticApiKey, setSemanticApiKey] = useState("");
  const [matchedRows, setMatchedRows] = useState([]);
  const [notFoundTitles, setNotFoundTitles] = useState([]);
  const [matchingLog, setMatchingLog] = useState("");
  const [matchingRunning, setMatchingRunning] = useState(false);
  const [hasMatchOutput, setHasMatchOutput] = useState(false);

  function waitForIdle() {
    return new Promise((resolve) => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(resolve, { timeout: 800 });
      else setTimeout(resolve, 50);
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRealDistributions() {
      const entries = Object.entries(csvFileLoaders);
      const lightLoaded = [];
      setLoadingRealDist(true);
      setLoadMessage("Loading real-world distribution files...");

      for (const [path, loader] of entries) {
        if (cancelled) return;
        const raw = await loader();
        const f = getFileName(path);
        setLoadMessage(`Loading ${f}...`);
        lightLoaded.push({
          path,
          fileName: f,
          query: getQueryName(f),
          rows: parseCSV(raw, { skipColumns: ["authors"] }),
          authorsLoaded: false,
        });
        setDatasets([...lightLoaded]);
        setSelectedQuery((prev) => prev || getQueryName(f));
        await waitForIdle();
      }

      setLoadingRealDist(false);
      setLoadingAuthors(true);
      setLoadMessage("Loading long authors columns in background...");

      for (const [path, loader] of entries) {
        if (cancelled) return;
        const raw = await loader();
        const f = getFileName(path);
        await waitForIdle();
        const fullRows = parseCSV(raw);
        setDatasets((prev) =>
          prev.map((d) =>
            d.path === path ? { ...d, rows: fullRows, authorsLoaded: true } : d
          )
        );
      }

      setLoadingAuthors(false);
      setLoadMessage("");
    }

    loadRealDistributions();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = datasets.find((d) => d.query === selectedQuery);

  const dims = useMemo(() => {
    const detected = detectDims(selected?.rows || []);
    return DIMENSION_ORDER.map((name) => findDim(detected, name)).filter(Boolean);
  }, [selected]);

  const active = dims.find((d) => d.dimension === selectedDimension) || dims[0];
  const cdata = normalizeChartRows(chartData(selected?.rows || [], active, 40), active);
  const activeSystemRows = selectedSystem?.rawRows || uploadedSystems[0]?.rows || matchedRows || [];
  const systemCdata = normalizeChartRows(outputChartData(activeSystemRows, active, 40), active);
  const previewColumns = useMemo(() => getPreviewColumns(matchedRows), [matchedRows]);

  useEffect(() => {
    if (!selectedDimension && dims[0]?.dimension) setSelectedDimension(dims[0].dimension);
  }, [dims, selectedDimension]);

  async function loadFiles(files) {
    const fileList = Array.from(files || []).filter((f) => f.name.toLowerCase().endsWith(".csv"));
    if (!fileList.length) return;
    const loaded = [];
    for (const file of fileList) {
      const text = await file.text();
      loaded.push({ fileName: file.name.replace(/\.csv$/i, ""), rows: parseCSV(text) });
    }
    setUploadedSystems((prev) => aggregateSystemRows([...prev, ...loaded]));
    setBench([]);
    setSelectedSystem(null);
    setSelectedDetail(null);
  }

  function sanitizeBenchmarkRows(rows) {
    return (rows || []).map((row) => ({
      ...row,
      "citation percentile (by year/subfield)":
        row?.["citation percentile (by year/subfield)"] == null
          ? ""
          : String(row["citation percentile (by year/subfield)"]),
      year: row?.year == null ? "" : String(row.year),
      "cited by": row?.["cited by"] == null ? "" : String(row["cited by"]),
      reference: row?.reference == null ? "" : String(row.reference),
    }));
  }

  function runBenchmarkWithRows(rows = uploadedSystems) {
    if (!selected || !rows.length) return;

    const allResults = rows.map((sys) => {
      const safeRows = sanitizeBenchmarkRows(sys.rows);
      const result = benchmark(selected.rows, safeRows, dims);
      const rowMap = Object.fromEntries(
        result.filter((r) => r.score != null).map((r) => [r.dimension, r.score])
      );
      const categoryScores = CATEGORY_ORDER.map((cat) => {
        const cols = CATEGORY_COLUMNS[cat] || [];
        const vals = cols.map((col) => rowMap[col]).filter((v) => v != null && !Number.isNaN(v));
        if (!vals.length) return null;
        return vals.reduce((s, v) => s + v, 0) / vals.length;
      }).filter((v) => v != null);
      const total = categoryScores.length
        ? categoryScores.reduce((s, v) => s + v, 0) / categoryScores.length
        : null;
      return {
        system: sys.fileName,
        total,
        fileCount: sys.fileCount || 1,
        rows: result,
        rawRows: safeRows,
      };
    });

    setBench(allResults);
    setSelectedSystem(allResults[0] || null);
    setSelectedDetail(null);
  }

  function runBenchmark() {
    runBenchmarkWithRows(uploadedSystems);
  }

  async function loadInputCsvFiles(files) {
    const fileList = Array.from(files || []).filter((file) =>
      file.name.toLowerCase().endsWith(".csv")
    );

    if (!fileList.length) return;

    const loaded = [];

    for (const file of fileList) {
      const text = await file.text();
      loaded.push({
        fileName: file.name.replace(/\.csv$/i, ""),
        rows: parseCSV(text),
      });
    }

    const systems = aggregateSystemRows(loaded);
    const flatRows = systems.flatMap((system) => system.rows || []);
    const fileNames = fileList.map((file) => file.name).join(", ");

    setCsvInputFileName(fileNames);
    setCsvInputRows(flatRows);
    setCsvInputSystems(systems);
    setHasMatchOutput(false);
    setMatchedRows([]);
    setNotFoundTitles([]);
    setMatchingLog(
      `${fileList.length} CSV file(s) loaded · ${flatRows.length} row(s). Click Run Benchmark.`
    );
    setUploadedSystems([]);
    setBench([]);
    setSelectedSystem(null);
    setSelectedDetail(null);
  }

  async function handleInputCsvUpload(event) {
    await loadInputCsvFiles(event.target.files);
    event.target.value = "";
  }

  async function handleInputCsvDrop(event) {
    event.preventDefault();
    setCsvDragging(false);
    await loadInputCsvFiles(event.dataTransfer.files);
  }

  function handleInputCsvDragOver(event) {
    event.preventDefault();
    setCsvDragging(true);
  }

  function handleInputCsvDragLeave(event) {
    event.preventDefault();
    setCsvDragging(false);
  }

  function runCsvInputBenchmark() {
    if (!csvInputRows.length || !csvInputSystems.length || matchingRunning) return;

    setHasMatchOutput(true);
    setMatchedRows(csvInputRows);
    setNotFoundTitles([]);
    setMatchingLog(`CSV benchmark ready · ${csvInputSystems.length} system group(s) · ${csvInputRows.length} row(s)`);
    setUploadedSystems(csvInputSystems);
    runBenchmarkWithRows(csvInputSystems);
  }

  function runInputBenchmark() {
    if (inputMode === "csv") {
      runCsvInputBenchmark();
      return;
    }
    runTitleMatching();
  }

  async function runTitleMatching() {
    const titles = titleInput
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((title, idx, arr) => arr.findIndex((x) => normalizeTitle(x) === normalizeTitle(title)) === idx);

    if (!titles.length || matchingRunning) return;

    setMatchingRunning(true);
    setHasMatchOutput(true);
    setMatchedRows([]);
    setNotFoundTitles([]);
    setMatchingLog(`0/${titles.length} matched`);
    setUploadedSystems([]);
    setBench([]);
    setSelectedSystem(null);

    const liveRows = [];
    const liveNotFound = [];

    try {
      const response = await fetch(`${API_BASE}/api/benchmark/match-titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titles,
          queryWord: selectedQuery,
          openAlexApiKey,
          semanticApiKey,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No streaming response body from backend.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const event = JSON.parse(line);

          if (event.type === "progress") {
            setMatchingLog(event.message || "Matching...");
          }

          if (event.type === "found") {
            liveRows.push(event.row);
            setMatchedRows([...liveRows]);

            const system = [
              {
                fileName: "Titles Input Matched Papers",
                rows: [...liveRows],
                fileCount: 1,
              },
            ];

            setUploadedSystems(system);

            setMatchingLog(
              `${event.index}/${event.total} done · matched ${liveRows.length} · not found ${liveNotFound.length}`
            );
          }

          if (event.type === "not_found") {
            liveNotFound.push(event.title);
            setNotFoundTitles([...liveNotFound]);
            setMatchingLog(
              `${event.index}/${event.total} done · matched ${liveRows.length} · not found ${liveNotFound.length}`
            );
          }

          if (event.type === "done") {
            setMatchingLog(
              `Finished · matched ${event.matched} · not found ${event.notFound}`
            );
          }
        }
      }

      if (liveRows.length) {
        const system = [
          {
            fileName: "Titles Input Matched Papers",
            rows: liveRows,
            fileCount: 1,
          },
        ];
        setUploadedSystems(system);
        runBenchmarkWithRows(system);
      }
    } catch (error) {
      setMatchingLog(`Matching failed: ${error.message}`);
    } finally {
      setMatchingRunning(false);
    }
  }

  function downloadMatchedCsv() {
    downloadTextFile("matched_titles.csv", rowsToCsv(matchedRows), "text/csv;charset=utf-8");
  }

  function downloadNotFoundTxt() {
    downloadTextFile("not_found_titles.txt", notFoundTitles.join("\n"), "text/plain;charset=utf-8");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background: `
          radial-gradient(circle at top left, rgba(59,130,246,0.10), transparent 28%),
          radial-gradient(circle at 85% 20%, rgba(99,102,241,0.10), transparent 30%),
          linear-gradient(180deg, #ffffff 0%, #f8fbff 45%, #f3f7fc 100%)
        `,
        color: "#111827",
        padding: "28px 20px 48px",
        fontFamily: "Inter, Arial, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -180,
          left: -120,
          width: 420,
          height: 390,
          borderRadius: "50%",
          background: "rgba(59,130,246,0.12)",
          filter: "blur(120px)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 120,
          right: -100,
          width: 340,
          height: 340,
          borderRadius: "50%",
          background: "rgba(99,102,241,0.10)",
          filter: "blur(120px)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
          <h1
            style={{
              fontSize: "clamp(40px, 5vw, 72px)",
              marginTop: 40,
              marginBottom: 84,
              textAlign: "center",
              fontWeight: 900,
              letterSpacing: "-0.05em",
              lineHeight: 1,
              color: "#111827",
              maxWidth: 1400,
            }}
          >
            Scholarly Distributional Fidelity Benchmark
          </h1>
        </div>

        {(loadingRealDist || loadingAuthors) && (
          <div
            style={{
              margin: "0 auto 28px",
              maxWidth: "none",
              padding: "12px 16px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.78)",
              border: "1px solid #dbeafe",
              color: "#1e40af",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {loadingRealDist ? "Loading benchmark data..." : "Loading authors columns in background..."}
            <span style={{ marginLeft: 8, fontWeight: 500 }}>{loadMessage}</span>
          </div>
        )}

        <div
          style={{
            width: "100%",
            margin: 0,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 24,
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.82)",
              border: "1px solid rgba(226,232,240,0.9)",
              borderRadius: 30,
              padding: 30,
              boxShadow: "0 24px 70px rgba(15,23,42,0.09)",
              height: "100%",
              alignSelf: "stretch",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                marginBottom: 22,
              }}
            >
              <div style={{ fontSize: 30, fontWeight: 900 }}>Titles Input</div>

              <div
                style={{
                  display: "inline-flex",
                  padding: 4,
                  borderRadius: 14,
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                }}
              >
                {[
                  ["titles", "Titles"],
                  ["csv", "CSV File"],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setInputMode(mode);
                      setHasMatchOutput(false);
                      setMatchedRows([]);
                      setNotFoundTitles([]);
                      setBench([]);
                      setCsvDragging(false);
                      setSelectedSystem(null);
                      setSelectedDetail(null);
                      setMatchingLog(mode === "csv" ? "Upload a matched CSV file." : "OpenAlex → Semantic Scholar → Crossref 순서로 title matching.");
                    }}
                    style={{
                      padding: "8px 13px",
                      borderRadius: 11,
                      border: "none",
                      background: inputMode === mode ? "white" : "transparent",
                      color: inputMode === mode ? "#111827" : "#64748b",
                      fontWeight: 900,
                      cursor: "pointer",
                      boxShadow: inputMode === mode ? "0 6px 16px rgba(15,23,42,0.08)" : "none",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {inputMode === "titles" && (
              <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <label style={{ display: "grid", gap: 7 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>OPENALEX_API_KEY</span>
                <input
                  type="password"
                  value={openAlexApiKey}
                  onChange={(e) => setOpenAlexApiKey(e.target.value)}
                  placeholder="Optional OpenAlex API key"
                  style={{
                    padding: "13px 14px",
                    borderRadius: 14,
                    border: "1px solid #dbe3f0",
                    outline: "none",
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 7 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>SEMANTIC_API_KEY</span>
                <input
                  type="password"
                  value={semanticApiKey}
                  onChange={(e) => setSemanticApiKey(e.target.value)}
                  placeholder="Optional Semantic Scholar API key"
                  style={{
                    padding: "13px 14px",
                    borderRadius: 14,
                    border: "1px solid #dbe3f0",
                    outline: "none",
                    fontSize: 14,
                  }}
                />
              </label>
            </div>

            <textarea
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder={`Input paper titles here...

Attention Is All You Need
BERT: Pre-training of Deep Bidirectional Transformers
Deep Residual Learning for Image Recognition`}
              style={{
                width: "100%",
                height: 290,
                resize: "none",
                borderRadius: 20,
                border: "1px solid #dbe3f0",
                padding: 20,
                fontSize: 15,
                lineHeight: 1.7,
                background: "white",
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "Inter, Arial, sans-serif",
              }}
            />

              </>
            )}

            {inputMode === "csv" && (
              <div
                onDrop={handleInputCsvDrop}
                onDragOver={handleInputCsvDragOver}
                onDragLeave={handleInputCsvDragLeave}
                style={{
                  border: csvDragging ? "2px solid #2563eb" : "1px dashed #cbd5e1",
                  borderRadius: 20,
                  background: csvDragging ? "#eff6ff" : "#f8fafc",
                  padding: 24,
                  minHeight: 290,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  gap: 14,
                  transition: "0.18s ease",
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 900 }}>
                  Drag & Drop Matched CSV Files
                </div>
                <div style={{ color: "#64748b", fontSize: 14, lineHeight: 1.6, maxWidth: 620 }}>
                  CSV mode skips API matching and benchmarks uploaded system-output CSV files directly.
                  You can drag multiple CSV files here or choose multiple files from your computer.
                </div>
                <input
                  type="file"
                  accept=".csv"
                  multiple
                  onChange={handleInputCsvUpload}
                  style={{ marginTop: 8 }}
                />
                <div style={{ color: csvInputRows.length ? "#2563eb" : "#94a3b8", fontWeight: 800 }}>
                  {csvInputRows.length
                    ? `${csvInputSystems.length} system group(s) · ${csvInputRows.length} row(s) loaded`
                    : "No CSV selected"}
                </div>
                {csvInputFileName && (
                  <div
                    style={{
                      maxWidth: "100%",
                      color: "#64748b",
                      fontSize: 12,
                      lineHeight: 1.6,
                      wordBreak: "break-word",
                    }}
                  >
                    {csvInputFileName}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
              <button
                onClick={runInputBenchmark}
                disabled={matchingRunning || (inputMode === "csv" && !csvInputSystems.length)}
                style={{
                  flex: 1,
                  padding: "15px 18px",
                  borderRadius: 16,
                  border: "none",
                  background: matchingRunning || (inputMode === "csv" && !csvInputSystems.length) ? "#94a3b8" : "#2563eb",
                  color: "white",
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: matchingRunning || (inputMode === "csv" && !csvInputSystems.length) ? "not-allowed" : "pointer",
                  boxShadow: "0 10px 30px rgba(37,99,235,0.25)",
                }}
              >
                {matchingRunning ? "Matching..." : inputMode === "csv" ? "Run Benchmark with CSV" : "Run Benchmark"}
              </button>

            </div>

            <div style={{ marginTop: 14, color: "#64748b", fontSize: 13, minHeight: 20 }}>
              {matchingLog || (inputMode === "csv" ? "Upload a matched CSV file, then run benchmark." : "OpenAlex → Semantic Scholar → Crossref 순서로 title matching.")}
            </div>

          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 24, height: "100%", alignSelf: "stretch", minWidth: 0 }}>
            <div
              style={{
                background: "rgba(255,255,255,0.78)",
                border: "1px solid rgba(226,232,240,0.9)",
                borderRadius: 28,
                padding: 24,
                boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
                minWidth: 0,
                boxSizing: "border-box",
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 18 }}>Query Word</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {datasets.map((d) => (
                  <button
                    key={d.path}
                    onClick={() => {
                      setSelectedQuery(d.query);
                      setSelectedDimension("");
                      setBench([]);
                    }}
                    style={{
                      padding: "10px 15px",
                      borderRadius: 13,
                      border: "1px solid #dbe3f0",
                      background: selectedQuery === d.query ? "#2563eb" : "white",
                      color: selectedQuery === d.query ? "white" : "#111827",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {d.query}
                  </button>
                ))}
              </div>
            </div>

            {selected && (
              <div
                style={{
                  background: "rgba(255,255,255,0.78)",
                  borderRadius: 28,
                  padding: 24,
                  border: "1px solid rgba(226,232,240,0.9)",
                  boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
                  minWidth: 0,
                  boxSizing: "border-box",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 16,
                    marginBottom: 18,
                  }}
                >
                  <div style={{ fontSize: 24, fontWeight: 900 }}>Real-World Distribution</div>
                  <select
                    value={active?.dimension || ""}
                    onChange={(e) => setSelectedDimension(e.target.value)}
                    style={{
                      maxWidth: 220,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #dbe3f0",
                      background: "white",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {dims.map((d) => (
                      <option key={d.dimension} value={d.dimension}>
                        {d.dimension}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 22, flex: 1 }}>
                  <div>

                    <div style={{ width: "100%", overflowX: "auto", paddingBottom: 8 }}>
                      <div
                        style={{
                          minWidth: Math.max(760, normalizeChartRows(cdata, active).length * 56),
                          height: 350,
                        }}
                      >
                      {normalizeChartRows(cdata, active).length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={normalizeChartRows(cdata, active)} margin={{ top: 8, right: 8, left: 0, bottom: 42 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="name"
                              angle={active?.dimension === "year" ? -32 : -35}
                              textAnchor="end"
                              height={active?.dimension === "year" ? 82 : 100}
                              interval={0}
                              tickFormatter={active?.dimension === "year" ? yearTickFormatter : undefined}
                              tick={{ fill: "#334155", fontSize: 11 }}
                            />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="value" fill="#94a3b8" minPointSize={2} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", border: "1px dashed #cbd5e1", borderRadius: 18 }}>
                          No real-world chart data yet.
                        </div>
                      )}
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            )}


          </div>
        </div>

        {hasMatchOutput && (
          <div
            style={{
              marginTop: 24,
              background: "rgba(255,255,255,0.82)",
              border: "1px solid rgba(226,232,240,0.9)",
              borderRadius: 28,
              padding: 24,
              boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 900 }}>
                Matching Results
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={downloadMatchedCsv}
                  disabled={!matchedRows.length}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 13,
                    border: "1px solid #dbe3f0",
                    background: matchedRows.length ? "#111827" : "#f1f5f9",
                    color: matchedRows.length ? "white" : "#94a3b8",
                    fontWeight: 800,
                    cursor: matchedRows.length ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap",
                  }}
                >
                  Download CSV
                </button>

                <button
                  onClick={downloadNotFoundTxt}
                  disabled={!notFoundTitles.length}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 13,
                    border: "1px solid #dbe3f0",
                    background: notFoundTitles.length ? "#111827" : "#f1f5f9",
                    color: notFoundTitles.length ? "white" : "#94a3b8",
                    fontWeight: 800,
                    cursor: notFoundTitles.length ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap",
                  }}
                >
                  Download TXT
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.55fr)",
                gap: 24,
                alignItems: "stretch",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>
                  Matched CSV Preview ({matchedRows.length})
                </div>

                <div
                  style={{
                    maxHeight: 360,
                    overflow: "auto",
                    border: "1px solid #e2e8f0",
                    borderRadius: 16,
                    background: "white",
                  }}
                >
                  <table
                    style={{
                      borderCollapse: "collapse",
                      width: "max-content",
                      minWidth: "100%",
                      fontSize: 12,
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {previewColumns.map((col) => (
                          <th
                            key={col}
                            style={{
                              padding: "9px 11px",
                              borderBottom: "1px solid #e2e8f0",
                              textAlign: "left",
                              whiteSpace: "nowrap",
                              position: "sticky",
                              top: 0,
                              background: "#f8fafc",
                              zIndex: 1,
                            }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matchedRows.length ? (
                        matchedRows.map((row, idx) => (
                          <tr key={`${row.title || row.doi || "row"}-${idx}`}>
                            {previewColumns.map((col) => (
                              <td
                                key={col}
                                style={{
                                  padding: "9px 11px",
                                  borderBottom: "1px solid #f1f5f9",
                                  verticalAlign: "top",
                                  whiteSpace: col === "title" || col === "authors" || col === "institutions" ? "normal" : "nowrap",
                                  minWidth: col === "title" ? 280 : col === "authors" || col === "institutions" ? 220 : 90,
                                  maxWidth: col === "title" ? 420 : col === "authors" || col === "institutions" ? 320 : 220,
                                }}
                              >
                                {row[col] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={previewColumns.length} style={{ padding: 18, color: "#94a3b8", textAlign: "center" }}>
                            Matched rows will be appended here in real time.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 12 }}>
                  Not Found TXT ({notFoundTitles.length})
                </div>

                <pre
                  style={{
                    minHeight: 360,
                    maxHeight: 360,
                    overflow: "auto",
                    margin: 0,
                    padding: 16,
                    borderRadius: 16,
                    border: "1px solid #e2e8f0",
                    background: "#0f172a",
                    color: "#e2e8f0",
                    fontSize: 12,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    boxSizing: "border-box",
                  }}
                >
                  {notFoundTitles.length ? notFoundTitles.join("\n") : "No unmatched titles yet."}
                </pre>
              </div>
            </div>
          </div>
        )}

        {bench.length > 0 && (
          <div
            style={{
              width: "100%",
              margin: "34px 0 0",
              background: "rgba(255,255,255,0.82)",
              border: "1px solid #e5e7eb",
              borderRadius: 28,
              padding: "30px",
              boxSizing: "border-box",
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
            }}
          >
            <h2 style={{ color: "#111827", marginTop: 0, marginBottom: 18 }}>
              Benchmark Summary
            </h2>

            <div style={{ overflowX: "auto", maxWidth: "100%" }}>
              <table
                border="1"
                cellPadding="8"
                style={{
                  borderCollapse: "collapse",
                  fontSize: 11,
                  background: "white",
                  tableLayout: "fixed",
                  width: "max-content",
                  minWidth: "100%",
                }}
              >
                <thead>
                  <tr>
                    {["System", "Files", "Total Score", ...DIMENSION_ORDER].map((label) => (
                      <th
                        key={label}
                        style={{
                          width: label === "System" ? 140 : 78,
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                          overflowWrap: "anywhere",
                          lineHeight: 1.15,
                          textAlign: "center",
                          verticalAlign: "middle",
                          padding: "6px 5px",
                        }}
                      >
                        {label}{label === "cited by" ? " ★" : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bench.map((sys) => {
                    const rowMap = {};
                    sys.rows.forEach((r) => {
                      rowMap[r.dimension] = r.score;
                    });
                    return (
                      <tr
                        key={sys.system}
                        onClick={() => {
                          setSelectedSystem(sys);
                          setSelectedDetail(null);
                        }}
                        style={{
                          cursor: "pointer",
                          background: selectedSystem?.system === sys.system ? "#dbeafe" : "white",
                        }}
                      >
                        <td style={{ textAlign: "center", padding: "6px 5px" }}><b>{sys.system}</b></td>
                        <td style={{ textAlign: "center", padding: "6px 5px" }}>{sys.fileCount}</td>
                        <td style={{ textAlign: "center", padding: "6px 5px" }}>{sys.total == null ? "-" : sys.total.toFixed(2)}</td>
                        {DIMENSION_ORDER.map((dim) => (
                          <td key={dim} style={{ textAlign: "center", padding: "6px 5px" }}>
                            {rowMap[dim] == null ? "-" : rowMap[dim].toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 8, lineHeight: 1.6 }}>
              ★ cited by: citation percentile bin method. Total score = average of 7 categories.
            </p>

            {selectedSystem && selectedSystem.rows?.length > 0 && (
              <div
                style={{
                  marginTop: 24,
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                  gap: 22,
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: 20,
                    padding: 22,
                    overflowX: "auto",
                  }}
                >
                  <h2 style={{ color: "#111827", marginTop: 0 }}>
                    Detailed Metrics: {selectedSystem.system}
                  </h2>

                  <table
                    border="1"
                    cellPadding="8"
                    style={{
                      borderCollapse: "collapse",
                      fontSize: 11,
                      background: "white",
                      tableLayout: "fixed",
                      width: "max-content",
                      minWidth: "100%",
                    }}
                  >
                    <thead>
                      <tr>
                        {["Dimension", "Score", "JSD", "TVD", "Entropy Gap", "Elite Gap", "Tail Gap", "Coverage Rate", "Recency Gap", "HHI"].map((label) => (
                          <th
                            key={label}
                            style={{
                              width: label === "Dimension" ? 120 : 82,
                              textAlign: "center",
                              padding: "6px 5px",
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSystem.rows.map((r) => (
                        <tr
                          key={r.dimension}
                          onClick={() => {
                            setSelectedDetail(r);
                            setSelectedDimension(r.dimension);
                          }}
                          style={{
                            cursor: "pointer",
                            background: selectedDetail?.dimension === r.dimension ? "#dbeafe" : "white",
                          }}
                        >
                          <td style={{ textAlign: "center", padding: "6px 5px" }}><b>{r.dimension}</b></td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{r.score == null ? "-" : r.score.toFixed(2)}</td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{fmt(r.jsd)}</td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{fmt(r.tvd)}</td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{fmt(r.entropyGap)}</td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{fmt(r.eliteGap)}</td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{fmt(r.tailGap)}</td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{fmt(r.coverageRate)}</td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{fmt(r.recencyGap)}</td>
                          <td style={{ textAlign: "center", padding: "6px 5px" }}>{fmt(r.hhiGap)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{
                    background: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: 20,
                    padding: 22,
                    minHeight: 360,
                  }}
                >
                  {selectedDetail ? (
                    <>
                      <h2 style={{ marginTop: 0 }}>
                        Dimension Detail: {selectedDetail.dimension}
                      </h2>
                      <div style={{ width: "100%", height: 320 }}>
                        <ResponsiveContainer>
                          <BarChart
                            data={makeComparisonData(
                              selectedDetail.realDist,
                              selectedDetail.systemDist,
                              selectedDetail.dimension
                            )}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                              dataKey="name"
                              angle={-35}
                              textAnchor="end"
                              height={140}
                              interval={0}
                              tick={{ fill: "#374151", fontSize: 12 }}
                            />
                            <YAxis tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} />
                            <Tooltip content={<CompareTooltip />} />
                            <Bar dataKey="real" fill="#94a3b8" name="Real" />
                            <Bar dataKey="system" fill="#2563eb" name="System" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        height: 320,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#94a3b8",
                        border: "1px dashed #cbd5e1",
                        borderRadius: 18,
                        background: "#f8fafc",
                        textAlign: "center",
                        padding: 20,
                      }}
                    >
                      Click a row in Detailed Metrics to show Dimension Detail.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
