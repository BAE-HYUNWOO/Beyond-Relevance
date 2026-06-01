import { useEffect, useRef, useState } from "react";

import ConsolePanel from "../components/ConsolePanel";
import DataFilesPanel from "../components/DataFilesPanel";

import CollectionPageLayout from "../components/CollectionPageLayout";
import "./LLMsPage.css";
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentTime() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function makeRunTag(runDate, runTime) {
  const date = String(runDate || "").replace(/-/g, "");
  const time = String(runTime || "").replace(/:/g, "").slice(0, 4);
  return `${date}_${time}`;
}

function safeFilePart(value) {
  return String(value || "").replace(/[\\/:*?"<>|]+/g, "_").trim();
}

function normalizeDataPath(value) {
  let path = String(value || "").trim();
  if (!path) return "";

  path = path.replace(/^GENERATED_FILE=/, "").trim();
  path = path.replace(/^\[SAVED\]\s*/, "").trim();
  path = path.replace(/^\[SAVED CSV\]\s*/, "").trim();
  path = path.replace(/^\[SAVE\]\s*Writing file:\s*/, "").trim();
  path = path.replace(/^"|"$/g, "");
  path = path.replace(/\\/g, "/");

  const marker = "/beyond-relevance/";
  const markerIndex = path.toLowerCase().indexOf(marker);
  if (markerIndex >= 0) {
    path = path.slice(markerIndex + marker.length);
  }

  const srcDataIndex = path.indexOf("src/data/");
  if (srcDataIndex >= 0) return path.slice(srcDataIndex);

  const dataIndex = path.indexOf("data/");
  if (dataIndex >= 0) return path.slice(dataIndex);

  return path;
}

function uniquePaths(paths) {
  const seen = new Set();
  const out = [];

  (paths || []).forEach((item) => {
    const normalized = normalizeDataPath(item);
    if (!normalized) return;
    if (!/\.(csv|txt|json|md)$/i.test(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });

  return out;
}

function extractGeneratedFilePaths(logText, runTag) {
  const paths = [];
  const lines = String(logText || "").split(/\n+/);

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("GENERATED_FILE=")) {
      paths.push(trimmed.replace("GENERATED_FILE=", "").trim());
      return;
    }

    let match = trimmed.match(/^\[SAVED\]\s+(.+)$/);
    if (match) {
      paths.push(match[1]);
      return;
    }

    match = trimmed.match(/^\[SAVED CSV\]\s+(.+?)\s*\|/);
    if (match) {
      paths.push(match[1]);
      return;
    }

    match = trimmed.match(/^\[SAVE\]\s*Writing file:\s*(.+)$/);
    if (match) {
      paths.push(match[1]);
    }
  });

  return uniquePaths(paths).filter((path) => !runTag || path.includes(runTag));
}

function downloadTextAsFile(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename || "download.txt";

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}


export default function LLMsPage() {
  const [query, setQuery] = useState("");

  const [mergeLog, setMergeLog] = useState("");
  const [mergeError, setMergeError] = useState("");
  const [merging, setMerging] = useState(false);
  const runAbortControllerRef = useRef(null);

  const [dataTree, setDataTree] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState("");
  const [csvRows, setCsvRows] = useState([]);
  const [csvColumns, setCsvColumns] = useState([]);
  const [fileError, setFileError] = useState("");
  const [runGeneratedFiles, setRunGeneratedFiles] = useState([]);

  const [runDate, setRunDate] = useState(getTodayDate());
  const [runTime, setRunTime] = useState(getCurrentTime());

  const [llmConfig, setLlmConfig] = useState({
    OPENAI_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    GEMINI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENALEX_API_KEY: "",
    SEMANTIC_API_KEY: "",

    OPENAI_MODEL: "gpt-5.5",
    DEEPSEEK_MODEL: "deepseek-chat",
    GEMINI_MODEL: "gemini-2.5-pro",
    ANTHROPIC_MODEL: "claude-opus-4-7",

    LLM_TEMPERATURE: "0.3",
    LLM_MAX_OUTPUT_TOKENS: "8192",
    LLM_MAX_TOTAL_TITLES: "100",
  });

  useEffect(() => {
    loadDataTree();
  }, []);

  useEffect(() => {
    if (!selectedFile && runGeneratedFiles.length > 0) {
      openDataFile(runGeneratedFiles[0]).catch(() => { });
    }
  }, [runGeneratedFiles, selectedFile]);

  function handleLlmConfigChange(key, value) {
    setLlmConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function loadDataTree() {
    try {
      const res = await fetch(`${API_BASE}/api/data/tree`);
      const data = await res.json();

      if (data.success) {
        setDataTree(data.tree || []);
      }
    } catch (error) {
      console.error(error);
    }
  }

  function parseCsv(text) {
    const rows = [];
    let current = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"' && inQuotes && next === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        current.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i++;

        current.push(value);
        rows.push(current);

        current = [];
        value = "";
      } else {
        value += char;
      }
    }

    if (value || current.length) {
      current.push(value);
      rows.push(current);
    }

    return rows.filter((row) =>
      row.some((cell) => String(cell).trim() !== "")
    );
  }

  async function openDataFile(path) {
    setSelectedFile(path);
    setFileError("");
    setCsvRows([]);
    setCsvColumns([]);

    try {
      const res = await fetch(
        `${API_BASE}/api/data/file?path=${encodeURIComponent(path)}`
      );

      const text = await res.text();

      if (!res.ok) {
        setFileError(text);
        setFileContent("");
        return;
      }

      setFileContent(text);

      if (path.toLowerCase().endsWith(".csv")) {
        const parsed = parseCsv(text);

        if (parsed.length > 0) {
          setCsvColumns(parsed[0]);

          const body = parsed.slice(1).map((row) => {
            const obj = {};

            parsed[0].forEach((col, idx) => {
              obj[col] = row[idx] || "";
            });

            return obj;
          });

          setCsvRows(body);
        }
      }
    } catch (error) {
      setFileError(String(error));
      setFileContent("");
    }
  }

  async function handleMergeRawFiles() {
    const controller = new AbortController();
    runAbortControllerRef.current = controller;

    setMerging(true);
    setMergeLog("");
    setMergeError("");

    try {
      const res = await fetch(
        `${API_BASE}/api/merge/raw-to-processed`,
        {
          method: "POST",
          signal: controller.signal,
        }
      );

      const data = await res.json();

      setMergeLog(JSON.stringify(data, null, 2));

      await loadDataTree();
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        setMergeLog((prev) => `${prev}
[STOPPED] User stopped the running task.
`);
      } else {
        setMergeError(String(error));
      }
    } finally {
      if (runAbortControllerRef.current === controller) {
        runAbortControllerRef.current = null;
      }
      setMerging(false);
    }
  }

  async function stopRunningTask() {
    const controller = runAbortControllerRef.current;

    if (controller) {
      controller.abort();
    }

    setMerging(false);
    setMergeLog((prev) => `${prev}
[UI] Stop requested.
`);

    try {
      await fetch(`${API_BASE}/api/llms/stop`, { method: "POST" });
    } catch {
      // Older backend versions may not have /api/llms/stop.
      // AbortController still stops the current browser-side stream.
    }
  }


  function extractTitlesFromLog(text) {
    return String(text || "")
      .split(/\n+/)
      .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
      .filter((line) => line.length > 3)
      .filter((title, idx, arr) => arr.findIndex((x) => x.toLowerCase() === title.toLowerCase()) === idx);
  }

  function downloadSelectedFile() {
    if (!selectedFile || !fileContent) return;

    downloadTextAsFile(
      selectedFile.split("/").pop() || "download.txt",
      fileContent,
      selectedFile.toLowerCase().endsWith(".csv")
        ? "text/csv;charset=utf-8"
        : "text/plain;charset=utf-8"
    );
  }

  async function handleRunLlms() {
    const controller = new AbortController();
    runAbortControllerRef.current = controller;

    setMerging(true);
    setMergeLog("");
    setMergeError("");
    setRunGeneratedFiles([]);
    setSelectedFile(null);
    setFileContent("");
    setCsvRows([]);
    setCsvColumns([]);
    setFileError("");

    const runTag = makeRunTag(runDate, runTime);

    try {
      const response = await fetch(`${API_BASE}/api/llms/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          query,
          runDate,
          runTime,
          llmConfig,
        }),
        signal: controller.signal,
      });

      if (!response.body) {
        throw new Error("No response body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let fullLog = "";

      while (true) {
        if (controller.signal.aborted) break;
        const { value, done } = await reader.read();

        if (done) break;

        fullLog += decoder.decode(value, {
          stream: true,
        });

        setMergeLog(fullLog);
        setRunGeneratedFiles(extractGeneratedFilePaths(fullLog, runTag));
      }

      const titles = extractTitlesFromLog(fullLog);

      if (titles.length) {
        const enrichResponse = await fetch(`${API_BASE}/api/llms/run-enriched`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            runDate,
            runTime,
            llmConfig,
            titles,
          }),
          signal: controller.signal,
        });

        if (!enrichResponse.body) {
          throw new Error("No enrichment response body.");
        }

        const enrichReader = enrichResponse.body.getReader();
        const enrichDecoder = new TextDecoder();

        let enrichLog = "\n\n--- ENRICHMENT: papers_dataset → OpenAlex → Semantic Scholar → Crossref ---\n";
        let generatedFiles = extractGeneratedFilePaths(fullLog, runTag);

        while (true) {
          if (controller.signal.aborted) break;
          const { value, done } = await enrichReader.read();

          if (done) break;

          const chunk = enrichDecoder.decode(value, {
            stream: true,
          });

          enrichLog += chunk;

          chunk.split(/\n+/).forEach((line) => {
            if (line.startsWith("GENERATED_FILE=")) {
              generatedFiles.push(normalizeDataPath(line.replace("GENERATED_FILE=", "").trim()));
            }
          });

          setRunGeneratedFiles(uniquePaths(generatedFiles).filter((path) => path.includes(runTag)));
          setMergeLog(fullLog + enrichLog);
        }
      }

      if (!controller.signal.aborted) {
        await loadDataTree();
      }
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        setMergeLog((prev) => `${prev}
[STOPPED] User stopped the running task.
`);
      } else {
        setMergeError(String(error));
      }
    } finally {
      if (runAbortControllerRef.current === controller) {
        runAbortControllerRef.current = null;
      }
      setMerging(false);
    }
  }

  return (
    <CollectionPageLayout
      activeLabel="LLMs"
      title="LLMs Collection"
      subtitle="Generate paper titles with LLMs, enrich them through papers_dataset/OpenAlex/Semantic Scholar/Crossref, and save matched outputs."
    >
      <>
        <section className="llms-page-grid">
          <div className="llms-fixed-card">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 180px 180px",
                gap: 12,
                alignItems: "end",
              }}
            >
              <label style={{ display: "grid", gap: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#475569",
                  }}
                >
                  SEARCH_QUERY
                </span>

                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search query..."
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "1px solid #cbd5e1",
                    fontSize: 15,
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#475569",
                  }}
                >
                  RUN_DATE
                </span>

                <input
                  type="date"
                  value={runDate}
                  onChange={(e) => setRunDate(e.target.value)}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "1px solid #cbd5e1",
                    fontSize: 14,
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#475569",
                  }}
                >
                  RUN_TIME
                </span>

                <input
                  type="time"
                  value={runTime}
                  onChange={(e) => setRunTime(e.target.value)}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "1px solid #cbd5e1",
                    fontSize: 14,
                  }}
                />
              </label>
            </div>

            {/* API KEYS */}

            <div
              style={{
                marginTop: 18,
                paddingTop: 14,
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 900,
                  marginBottom: 12,
                  color: "#334155",
                }}
              >
                API Keys
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {[
                  "OPENAI_API_KEY",
                  "DEEPSEEK_API_KEY",
                  "GEMINI_API_KEY",
                  "ANTHROPIC_API_KEY",
                ].map((key) => (
                  <label key={key} style={{ display: "grid", gap: 5 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#475569",
                      }}
                    >
                      {key}
                    </span>

                    <input
                      type="password"
                      value={llmConfig[key]}
                      onChange={(e) =>
                        handleLlmConfigChange(key, e.target.value)
                      }
                      placeholder="For LLM title generation"
                      autoComplete="off"
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        fontSize: 13,
                      }}
                    />
                  </label>
                ))}
              </div>

              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 14,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    marginBottom: 10,
                    color: "#334155",
                  }}
                >
                  Matching / Enrichment API Keys
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  {["OPENALEX_API_KEY", "SEMANTIC_API_KEY"].map((key) => (
                    <label key={key} style={{ display: "grid", gap: 5 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#475569",
                        }}
                      >
                        {key}
                      </span>

                      <input
                        type="password"
                        value={llmConfig[key]}
                        onChange={(e) =>
                          handleLlmConfigChange(key, e.target.value)
                        }
                        placeholder="Optional, improves matching stability"
                        autoComplete="off"
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid #cbd5e1",
                          fontSize: 13,
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* MODELS */}

            <div
              style={{
                marginTop: 18,
                paddingTop: 14,
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 900,
                  marginBottom: 12,
                  color: "#334155",
                }}
              >
                Models
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {[
                  "OPENAI_MODEL",
                  "DEEPSEEK_MODEL",
                  "GEMINI_MODEL",
                  "ANTHROPIC_MODEL",
                ].map((key) => (
                  <label key={key} style={{ display: "grid", gap: 5 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#475569",
                      }}
                    >
                      {key}
                    </span>

                    <input
                      type="text"
                      value={llmConfig[key]}
                      onChange={(e) =>
                        handleLlmConfigChange(key, e.target.value)
                      }
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        fontSize: 13,
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* GENERATION SETTINGS */}

            <div
              style={{
                marginTop: 18,
                paddingTop: 14,
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 900,
                  marginBottom: 12,
                  color: "#334155",
                }}
              >
                Generation Settings
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                {[
                  "LLM_TEMPERATURE",
                  "LLM_MAX_OUTPUT_TOKENS",
                  "LLM_MAX_TOTAL_TITLES",
                ].map((key) => (
                  <label key={key} style={{ display: "grid", gap: 5 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#475569",
                      }}
                    >
                      {key}
                    </span>

                    <input
                      type="text"
                      value={llmConfig[key]}
                      onChange={(e) =>
                        handleLlmConfigChange(key, e.target.value)
                      }
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid #cbd5e1",
                        fontSize: 13,
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* BUTTONS */}

            <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
              <button
                onClick={handleMergeRawFiles}
                disabled={merging}
                style={{
                  padding: "12px 18px",
                  borderRadius: 12,
                  border: "none",
                  background: merging ? "#94a3b8" : "#16a34a",
                  color: "white",
                  fontWeight: 800,
                  cursor: merging ? "not-allowed" : "pointer",
                }}
              >
                {merging ? "Merging..." : "Merge Files"}
              </button>

              <button
                onClick={handleRunLlms}
                disabled={merging}
                style={{
                  padding: "12px 18px",
                  borderRadius: 12,
                  border: "none",
                  background: merging ? "#94a3b8" : "#2563eb",
                  color: "white",
                  fontWeight: 800,
                  cursor: merging ? "not-allowed" : "pointer",
                }}
              >
                {merging ? "Running LLMs..." : "Run LLMs"}
              </button>

              {merging && (
                <button
                  onClick={stopRunningTask}
                  style={{
                    padding: "12px 18px",
                    borderRadius: 12,
                    border: "none",
                    background: "#dc2626",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Stop Running
                </button>
              )}
            </div>
          </div>

          <div className="llms-console-card">
            <ConsolePanel
              mergeLog={mergeLog}
              mergeError={mergeError}
            />
          </div>
        </section>

        <div
          style={{
            marginTop: 20,
            width: "min(1480px, calc(100vw - 48px))",
            marginInline: "auto",
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: 18,
            padding: 18,
            height: 360,
            overflow: "auto",
            resize: "none",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 900,
                color: "#111827",
              }}
            >
              Generated Files From This Run
            </div>

            <button
              onClick={downloadSelectedFile}
              disabled={!selectedFile || !fileContent}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                background: selectedFile && fileContent ? "#2563eb" : "#94a3b8",
                color: "white",
                fontWeight: 800,
                cursor: selectedFile && fileContent ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              Download Selected File
            </button>
          </div>

          {runGeneratedFiles.length > 0 ? (
            <div
              style={{
                display: "grid",
                gap: 10,
                marginBottom: 16,
              }}
            >
              {runGeneratedFiles.map((path) => (
                <button
                  key={path}
                  onClick={() => openDataFile(path)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #dbeafe",
                    background: selectedFile === path ? "#eff6ff" : "white",
                    color: "#2563eb",
                    fontWeight: 800,
                    textAlign: "left",
                    cursor: "pointer",
                    wordBreak: "break-word",
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: 18,
                border: "1px dashed #cbd5e1",
                borderRadius: 14,
                color: "#94a3b8",
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              Run LLMs to generate files for this run. Only files from the current run will appear here.
            </div>
          )}

          {selectedFile && (
            <DataFilesPanel
              dataTree={[]}
              selectedFile={selectedFile}
              fileContent={fileContent}
              csvRows={csvRows}
              csvColumns={csvColumns}
              fileError={fileError}
              openDataFile={openDataFile}
            />
          )}
        </div>
      </>
    </CollectionPageLayout>
  );
}
