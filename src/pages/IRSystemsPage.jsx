import { useMemo, useRef, useState } from "react";
import CollectionPageLayout from "../components/CollectionPageLayout";
import ConsolePanel from "../components/ConsolePanel";
import CsvPreview from "../components/CsvPreview";
import "./IRSystemsPage.css";

const API_BASE = "http://127.0.0.1:8000";

const IR_SYSTEM_OPTIONS = [
  { id: "google_scholar", label: "Google Scholar", shortLabel: "Google Scholar" },
  { id: "scopus", label: "Scopus", shortLabel: "Scopus" },
  { id: "web_of_science", label: "Web of Science", shortLabel: "Web of Science" },
];

function todayParts() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return { runDate: `${yyyy}-${mm}-${dd}`, runTime: `${hh}:${mi}` };
}

function makeRunTag(runDate, runTime) {
  const date = String(runDate || "").replaceAll("-", "");
  const time = String(runTime || "").replace(":", "").slice(0, 4);
  return `${date}_${time}`;
}

function safeName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_");
}

function systemIdFromName(name) {
  const x = String(name || "").toLowerCase();
  if (x.includes("google scholar")) return "google_scholar";
  if (x.includes("scopus")) return "scopus";
  if (x.includes("web of science")) return "web_of_science";
  return "unknown";
}

function systemNameFromId(id) {
  return IR_SYSTEM_OPTIONS.find((item) => item.id === id)?.label || id;
}

function fileName(path) {
  return String(path || "").split(/[\\/]/).pop() || path;
}

function fileBaseName(path) {
  return fileName(path).replace(/\.(csv|txt)$/i, "");
}

function formatFileTitle(path) {
  const name = fileName(path)
    .replace(/\.(csv|txt)$/i, "")
    .replace(/_(found|not_found)$/i, "")
    .replace(/_/g, " ");

  const match = name.match(/^(.+?)\s+(.+?)\s+(\d{8})\s+(\d{4})$/);
  if (!match) return name;

  const [, system, topic, date, time] = match;
  return `${system} · ${topic}`;
}

function formatFileMeta(path) {
  const name = fileName(path).replace(/\.(csv|txt)$/i, "");
  const match = name.match(/_(\d{8})_(\d{4})(?:_(found|not_found))?$/);
  if (!match) return "";

  const [, date, time, kind] = match;
  const meta = `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}`;

  if (kind === "found") return `${meta} · found CSV`;
  if (kind === "not_found") return `${meta} · not-found TXT`;
  return `${meta} · original CSV`;
}

function fileKind(path) {
  const lower = String(path || "").toLowerCase();
  if (lower.includes("/found_titles/") || lower.includes("\\found_titles\\") || lower.endsWith("_found.csv")) return "found";
  if (lower.includes("/not_found_titles/") || lower.includes("\\not_found_titles\\") || lower.endsWith("_not_found.txt")) return "not_found";
  if (lower.includes("/original_titles/") || lower.includes("\\original_titles\\") || lower.endsWith(".csv")) return "original";
  return "file";
}

function parseCsv(text) {
  if (!text || !text.trim()) return { columns: [], rows: [] };

  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);

  const columns = rows[0] || [];
  const dataRows = rows.slice(1).map((cells) => {
    const out = {};
    columns.forEach((col, idx) => {
      out[col] = cells[idx] || "";
    });
    return out;
  });

  return { columns, rows: dataRows };
}

function makeExpectedPaths(systemLabel, query, runTag) {
  const base = `${safeName(systemLabel)}_${safeName(query)}_${runTag}`;
  return [
    {
      path: `data/raw/ir_outputs/original_titles/${base}.csv`,
      status: "collecting",
      kind: "original",
    },
    {
      path: `data/raw/ir_outputs/found_titles/${base}_found.csv`,
      status: "matching",
      kind: "found",
    },
    {
      path: `data/raw/ir_outputs/not_found_titles/${base}_not_found.txt`,
      status: "matching",
      kind: "not_found",
    },
  ];
}

function mergeFiles(prev, incoming) {
  const map = new Map(prev.map((item) => [item.path, item]));

  incoming.forEach((item) => {
    const old = map.get(item.path);
    map.set(item.path, {
      ...(old || {}),
      ...item,
      status: item.status || old?.status || "ready",
      kind: item.kind || old?.kind || fileKind(item.path),
      systemId: item.systemId || old?.systemId || systemIdFromName(item.path),
    });
  });

  return Array.from(map.values());
}

function extractSavedPaths(chunk) {
  const paths = [];
  const patterns = [
    /\[SAVED CSV\]\s+(.+?)\s+\|\s+rows=/g,
    /\[SAVED GS CSV\]\s+(.+?)\s+\|\s+rows=/g,
    /\[SAVED\]\s+(.+?\.(?:csv|txt))/g,
    /GENERATED_FILE=(.+?\.(?:csv|txt))/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(chunk)) !== null) {
      const raw = String(match[1] || "").trim().replace(/\\/g, "/");
      const idx = raw.indexOf("data/");
      paths.push(idx >= 0 ? raw.slice(idx) : raw);
    }
  });

  return paths;
}

function extractMatchingBase(chunk) {
  const match = chunk.match(/===\s*(Google Scholar|Scopus|Web of Science)_(.+?)_(\d{8})_(\d{4})\.csv\s*\|/);
  if (!match) return null;
  const [, system, topic, date, time] = match;
  return `${system}_${topic}_${date}_${time}`;
}

function groupByKind(files) {
  const groups = {
    found: {
      id: "found",
      label: "Matched Files",
      description: "found.csv after DOI/title matching",
      icon: "✅",
      files: [],
    },
    original: {
      id: "original",
      label: "Original Files",
      description: "raw collected titles from IR systems",
      icon: "📄",
      files: [],
    },
    not_found: {
      id: "not_found",
      label: "Not Matched Files",
      description: "titles that could not be matched",
      icon: "⚠️",
      files: [],
    },
  };

  files.forEach((file) => {
    const kind = file.kind || fileKind(file.path);
    const groupKey = groups[kind] ? kind : "original";
    groups[groupKey].files.push(file);
  });

  const order = ["found", "original", "not_found"];
  return order
    .map((key) => groups[key])
    .filter((group) => group.files.length > 0)
    .map((group) => ({
      ...group,
      files: [...group.files].sort((a, b) => {
        const aName = fileName(a.path).localeCompare(fileName(b.path));
        if (a.status === b.status) return aName;
        if (a.status === "ready") return -1;
        if (b.status === "ready") return 1;
        return aName;
      }),
    }));
}

export default function IRSystemsPage() {
  const initial = useMemo(() => todayParts(), []);
  const abortRef = useRef(null);
  const currentMatchingBaseRef = useRef(null);

  const [query, setQuery] = useState("Machine Translation");
  const [maxRows, setMaxRows] = useState(30);
  const [runDate, setRunDate] = useState(initial.runDate);
  const [runTime, setRunTime] = useState(initial.runTime);
  const [selectedSystems, setSelectedSystems] = useState(["google_scholar"]);
  const [openAlexApiKey, setOpenAlexApiKey] = useState("");
  const [semanticApiKey, setSemanticApiKey] = useState("");

  const [isRunning, setIsRunning] = useState(false);
  const [log, setLog] = useState("");
  const [error, setError] = useState("");

  const [generatedFiles, setGeneratedFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [fileError, setFileError] = useState("");
  const [csvRows, setCsvRows] = useState([]);
  const [csvColumns, setCsvColumns] = useState([]);

  const canRun = query.trim() && selectedSystems.length > 0 && !isRunning;

  function toggleSystem(systemId) {
    if (isRunning) return;

    setSelectedSystems((prev) =>
      prev.includes(systemId)
        ? prev.filter((item) => item !== systemId)
        : [...prev, systemId]
    );
  }

  function prepareExpectedFiles() {
    const runTag = makeRunTag(runDate, runTime);
    const expected = selectedSystems.flatMap((id) =>
      makeExpectedPaths(systemNameFromId(id), query, runTag).map((item) => ({
        ...item,
        systemId: id,
      }))
    );

    setGeneratedFiles(expected);
    return expected;
  }

  function markMatchingBaseReady(baseName) {
    if (!baseName) return;

    setGeneratedFiles((prev) =>
      prev.map((item) => {
        const itemBase = fileBaseName(item.path)
          .replace(/_(found|not_found)$/i, "");

        if (itemBase !== baseName) return item;

        return {
          ...item,
          status: item.kind === "found" || item.kind === "not_found" ? "ready" : item.status,
        };
      })
    );
  }

  function handleLogChunk(chunk) {
    setLog((prev) => prev + chunk);

    const matchingBase = extractMatchingBase(chunk);
    if (matchingBase) {
      markMatchingBaseReady(currentMatchingBaseRef.current);
      currentMatchingBaseRef.current = matchingBase;

      setGeneratedFiles((prev) =>
        prev.map((item) => {
          const itemBase = fileBaseName(item.path)
            .replace(/_(found|not_found)$/i, "");

          if (itemBase !== matchingBase) return item;

          if (item.kind === "found" || item.kind === "not_found") {
            return { ...item, status: "matching" };
          }
          return item;
        })
      );
    }

    const savedPaths = extractSavedPaths(chunk).map((path) => ({
      path,
      status: "ready",
      kind: fileKind(path),
      systemId: systemIdFromName(path),
    }));

    if (savedPaths.length > 0) {
      setGeneratedFiles((prev) => mergeFiles(prev, savedPaths));
    }
  }

  async function runCollectionAndMatch() {
    if (!canRun) return;

    const controller = new AbortController();
    abortRef.current = controller;
    currentMatchingBaseRef.current = null;

    setIsRunning(true);
    setError("");
    setLog("");
    setSelectedFile("");
    setFileContent("");
    setFileError("");
    setCsvRows([]);
    setCsvColumns([]);
    prepareExpectedFiles();

    try {
      const res = await fetch(`${API_BASE}/api/ir/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          query,
          runDate,
          runTime,
          maxRows,
          systems: selectedSystems,
          openAlexApiKey,
          semanticApiKey,
          runMatching: true,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        handleLogChunk(decoder.decode(value, { stream: true }));
      }

      markMatchingBaseReady(currentMatchingBaseRef.current);

      setGeneratedFiles((prev) =>
        prev.map((item) =>
          item.status === "matching" ? { ...item, status: "ready" } : item
        )
      );
    } catch (err) {
      if (err?.name === "AbortError") {
        setError("Run stopped by user.");
      } else {
        setError(err?.message || String(err));
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      currentMatchingBaseRef.current = null;
    }
  }

  async function stopRunning() {
    try {
      abortRef.current?.abort();
      await fetch(`${API_BASE}/api/ir/stop`, { method: "POST" }).catch(() => {});
    } finally {
      setIsRunning(false);
    }
  }

  async function sendContinueSignal() {
    try {
      const res = await fetch(`${API_BASE}/api/ir/continue`, { method: "POST" });
      const data = await res.json();
      setLog((prev) => `${prev}\n[UI] ${data.message || "Continue signal sent."}\n`);
    } catch (err) {
      setError(err?.message || String(err));
    }
  }

  async function openGeneratedFile(file) {
    if (!file || file.status === "matching") return;

    setSelectedFile(file.path);
    setFileError("");
    setFileContent("");
    setCsvRows([]);
    setCsvColumns([]);

    try {
      const res = await fetch(
        `${API_BASE}/api/data/file?path=${encodeURIComponent(file.path)}`
      );

      const text = await res.text();

      if (!res.ok) {
        setFileError(text);
        return;
      }

      setFileContent(text);

      if (file.path.toLowerCase().endsWith(".csv")) {
        const parsed = parseCsv(text);
        setCsvColumns(parsed.columns);
        setCsvRows(parsed.rows);
      }
    } catch (err) {
      setFileError(String(err));
    }
  }

  function downloadSelectedFile() {
    if (!selectedFile || !fileContent) return;

    const blob = new Blob([fileContent], {
      type: selectedFile.toLowerCase().endsWith(".csv")
        ? "text/csv;charset=utf-8"
        : "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = selectedFile.split("/").pop() || "download.csv";

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  const groupedFiles = groupByKind(generatedFiles);

  return (
    <CollectionPageLayout
      activeLabel="IR-Systems"
      kicker="IR Systems Collection"
      title="Collect IR System Outputs"
      subtitle="Choose Google Scholar, Scopus, or Web of Science, crawl them sequentially, match collected titles by DOI/title, and download only this run's files."
    >
      <div className="ir-page-grid">
        <section className="ir-card ir-control-card">
          <div className="ir-card-header">
            <div>
              <span className="ir-eyebrow">Step 1</span>
              <h2>Collection Settings</h2>
            </div>
            <span className={isRunning ? "ir-status running" : "ir-status"}>
              {isRunning ? "Running" : "Ready"}
            </span>
          </div>

          <label className="ir-field">
            <span>Query word / topic</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>

          <div className="ir-two-cols">
            <label className="ir-field">
              <span>Run date</span>
              <input type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
            </label>

            <label className="ir-field">
              <span>Run time</span>
              <input type="time" value={runTime} onChange={(e) => setRunTime(e.target.value)} />
            </label>
          </div>

          <label className="ir-field">
            <span>Max titles per selected system</span>
            <input
              type="number"
              min="1"
              max="500"
              value={maxRows}
              onChange={(e) => setMaxRows(e.target.value)}
            />
          </label>

          <div className="ir-field">
            <span>IR systems</span>
            <div className="ir-system-list">
              {IR_SYSTEM_OPTIONS.map((system) => {
                const checked = selectedSystems.includes(system.id);
                return (
                  <button
                    key={system.id}
                    type="button"
                    className={`ir-system-card ${checked ? "selected" : ""}`}
                    onClick={() => toggleSystem(system.id)}
                    disabled={isRunning}
                  >
                    <span className="ir-system-checkbox" aria-hidden="true">
                      {checked ? "✓" : ""}
                    </span>
                    <span className="ir-system-name">{system.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ir-two-cols">
            <label className="ir-field">
              <span>OpenAlex API key</span>
              <input
                type="password"
                placeholder="optional"
                value={openAlexApiKey}
                onChange={(e) => setOpenAlexApiKey(e.target.value)}
              />
            </label>

            <label className="ir-field">
              <span>Semantic Scholar API key</span>
              <input
                type="password"
                placeholder="optional"
                value={semanticApiKey}
                onChange={(e) => setSemanticApiKey(e.target.value)}
              />
            </label>
          </div>

          <div className="ir-actions">
            <button className="ir-primary-btn" disabled={!canRun} onClick={runCollectionAndMatch}>
              {isRunning ? "Running..." : "Crawl + Match"}
            </button>

            {isRunning && (
              <button className="ir-stop-btn" type="button" onClick={stopRunning}>
                Stop Running
              </button>
            )}

            <button className="ir-secondary-btn" type="button" onClick={sendContinueSignal}>
              Continue Crawling
            </button>
          </div>

          <p className="ir-help-text">
            Scopus and Web of Science usually require browser login. After login/CAPTCHA, use Continue Crawling when the console asks for Enter.
          </p>
        </section>

        <section className="ir-console-wrap">
          <ConsolePanel mergeLog={log} mergeError={error} />
        </section>
      </div>

      <section className="ir-card ir-run-files-card">
        <div className="ir-run-files-header">
          <div>
            <span className="ir-eyebrow">Current Run</span>
            <h2>Generated Files From This Run</h2>
            <p>
              {generatedFiles.length > 0
                ? `${generatedFiles.length} file slot(s) · original files unlock after collection, matched files unlock after matching.`
                : "Run data collection to generate original, matched, and not-matched files."}
            </p>
          </div>

          <button
            className="ir-download-btn"
            type="button"
            disabled={!selectedFile || !fileContent}
            onClick={downloadSelectedFile}
          >
            Download Selected File
          </button>
        </div>

        <div className="ir-run-files-scroll">
          {groupedFiles.length > 0 ? (
            groupedFiles.map((group) => (
              <div className="ir-folder-block" key={group.id}>
                <div className="ir-folder-title">
                  <span className="ir-folder-icon">📁</span>
                  <div>
                    <h3>{group.label}</h3>
                    <p>{group.description} · {group.files.length} file(s)</p>
                  </div>
                </div>

                <div className="ir-file-grid">
                  {group.files.map((file) => {
                    const isBusy = file.status === "matching" || file.status === "collecting";
                    const isMatching = file.status === "matching";
                    const isCollecting = file.status === "collecting";
                    const isSelected = selectedFile === file.path;
                    const kindLabel =
                      file.kind === "found"
                        ? "Matched CSV"
                        : file.kind === "not_found"
                          ? "Not Matched TXT"
                          : "Original CSV";
                    const statusLabel = isCollecting
                      ? "Collecting..."
                      : isMatching
                        ? "Matching..."
                        : kindLabel;

                    return (
                      <button
                        key={file.path}
                        type="button"
                        className={`ir-file-card ${isSelected ? "selected" : ""} ${isBusy ? "disabled" : ""}`}
                        disabled={isBusy}
                        onClick={() => openGeneratedFile(file)}
                        title={fileName(file.path)}
                      >
                        <div className="ir-file-card-main">
                          <div className="ir-file-title">{formatFileTitle(file.path)}</div>
                          <div className="ir-file-meta">{formatFileMeta(file.path)}</div>
                        </div>

                        <span className={`ir-file-badge ${isBusy ? file.status : file.kind}`}>
                          {statusLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="ir-empty-preview">
              No files for the current run yet.
            </div>
          )}
        </div>

        {selectedFile && (
          <div className="ir-file-preview-panel">
            <div className="ir-file-preview-header">
              <div>
                <b>{fileName(selectedFile)}</b>
                <p>{formatFileMeta(selectedFile)}</p>
              </div>
            </div>

            {fileError ? (
              <pre className="ir-file-error">{fileError}</pre>
            ) : csvRows.length > 0 ? (
              <CsvPreview csvRows={csvRows} csvColumns={csvColumns} />
            ) : (
              <pre className="ir-text-preview">
                {fileContent || "Loading file preview..."}
              </pre>
            )}
          </div>
        )}
      </section>
    </CollectionPageLayout>
  );
}
