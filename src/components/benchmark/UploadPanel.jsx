import React, { useEffect, useMemo, useState } from "react";
import "./BenchmarkPage.css";

import { DIMENSION_ORDER, CATEGORY_ORDER, CATEGORY_COLUMNS } from "../benchmark/constants";

import {
  parseCSV,
  getFileName,
  getQueryName,
  detectDims,
  findDim,
  aggregateSystemRows,
} from "../benchmark/csvUtils";

import { benchmark } from "../benchmark/metrics";

import {
  chartData,
  outputChartData,
} from "../benchmark/chartUtils";

import SampleDownloadCard from "../components/benchmark/SampleDownloadCard";
import BenchmarkCharts from "../components/benchmark/BenchmarkCharts";
import BenchmarkSummaryTable from "../components/benchmark/BenchmarkSummaryTable";

const csvFileLoaders = import.meta.glob(
  "../data/processed/real_world_distribution/*.csv",
  { query: "?raw", import: "default" }
);

const sampleSystemOutputFiles = import.meta.glob(
  "../data/sample_system_outputs/**/*",
  { query: "?raw", import: "default", eager: true }
);

export default function BenchmarkPage() {
  const sampleFolders = useMemo(() => {
    const folders = {};

    Object.entries(sampleSystemOutputFiles).forEach(([path, raw]) => {
      const parts = path.split("/sample_system_outputs/")[1]?.split("/");
      if (!parts || parts.length < 2) return;

      const folderName = parts[0];
      const fileName = parts.slice(1).join("/");

      if (!folders[folderName]) {
        folders[folderName] = {
          label: folderName,
          folderName,
          files: {},
        };
      }

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
  const [isDragging, setIsDragging] = useState(false);

  function waitForIdle() {
    return new Promise((resolve) => {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(resolve, { timeout: 800 });
      } else {
        setTimeout(resolve, 50);
      }
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
        await waitForIdle();

        const fullRows = parseCSV(raw);

        setDatasets((prev) =>
          prev.map((d) =>
            d.path === path
              ? {
                  ...d,
                  rows: fullRows,
                  authorsLoaded: true,
                }
              : d
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

    return DIMENSION_ORDER
      .map((name) => findDim(detected, name))
      .filter(Boolean);
  }, [selected]);

  const active =
    dims.find((d) => d.dimension === selectedDimension) || dims[0];

  const cdata = chartData(selected?.rows || [], active, 20);
  const activeSystemRows =
    selectedSystem?.rawRows || uploadedSystems[0]?.rows || [];
  const activeSystemName =
    selectedSystem?.system || uploadedSystems[0]?.fileName || "";
  const systemCdata = outputChartData(activeSystemRows, active, 20);

  async function loadFiles(files) {
    const fileList = Array.from(files || []).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
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

    setUploadedSystems((prev) => aggregateSystemRows([...prev, ...loaded]));
    setBench([]);
    setSelectedSystem(null);
    setSelectedDetail(null);
  }

  function clearUploads() {
    setUploadedSystems([]);
    setBench([]);
    setSelectedSystem(null);
    setSelectedDetail(null);
  }

  async function upload(e) {
    await loadFiles(e.target.files);
  }

  async function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    await loadFiles(e.dataTransfer.files);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function runBenchmark() {
    if (!selected || !uploadedSystems.length) return;

    const allResults = uploadedSystems.map((sys) => {
      const result = benchmark(selected.rows, sys.rows, dims);

      const rowMap = Object.fromEntries(
        result
          .filter((r) => r.score != null)
          .map((r) => [r.dimension, r.score])
      );

      const categoryScores = CATEGORY_ORDER.map((cat) => {
        const cols = CATEGORY_COLUMNS[cat] || [];
        const vals = cols
          .map((col) => rowMap[col])
          .filter((v) => v != null && !Number.isNaN(v));

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
        rawRows: sys.rows,
      };
    });

    setBench(allResults);
    setSelectedSystem(allResults[0] || null);
    setSelectedDetail(null);
  }

  return (
    <div className="benchmark-root">
      <div className="benchmark-container">
        <div className="benchmark-hero">
          <div>
            <div className="benchmark-badge">
              Distributional Fidelity Benchmark
            </div>

            <h1 className="benchmark-title">
              Scholarly Distributional Fidelity Benchmark
            </h1>

            <p className="benchmark-subtitle">
              Select a query word to view benchmark distributions, upload
              system-output CSV files, and compare distributional fidelity
              across bibliographic dimensions.
            </p>
          </div>

          <SampleDownloadCard sampleFolders={sampleFolders} />
        </div>

        {(loadingRealDist || loadingAuthors) && (
          <div className="loading-banner">
            {loadingRealDist
              ? "Loading benchmark data..."
              : "Loading authors columns in background..."}
            <span style={{ marginLeft: 8, fontWeight: 500 }}>
              {loadMessage}
            </span>
          </div>
        )}

        <div className="info-banner">
          <b>v2 Changes:</b>&nbsp;
          ① <code>cited by</code> → citation percentile bin method
          &nbsp;|&nbsp;② hierarchical category/column/metric scoring
          &nbsp;|&nbsp;③ category averages
          &nbsp;|&nbsp;④ removed legacy exponent penalty
        </div>

        <h2 className="section-title">Query Word</h2>

        <div className="query-button-group">
          {datasets.map((d) => (
            <button
              key={d.path}
              onClick={() => {
                setSelectedQuery(d.query);
                setSelectedDimension("");
                setBench([]);
              }}
              className={
                selectedQuery === d.query
                  ? "query-button active"
                  : "query-button"
              }
            >
              {d.query}
            </button>
          ))}
        </div>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={isDragging ? "upload-panel dragging" : "upload-panel"}
        >
          <b>Upload system-output CSV:</b>

          <input type="file" accept=".csv" multiple onChange={upload} />

          <span style={{ color: "#64748b" }}>
            {uploadedSystems.length} file(s) uploaded
          </span>

          <button
            onClick={runBenchmark}
            disabled={!uploadedSystems.length}
            className="primary-button"
          >
            Run Benchmark
          </button>

          <button
            onClick={clearUploads}
            disabled={!uploadedSystems.length}
            className="danger-button"
          >
            Clear Uploads
          </button>
        </div>

        {selected && (
          <>
            <h2 className="section-title">Bibliographic Dimension</h2>

            <select
              value={active?.dimension || ""}
              onChange={(e) => setSelectedDimension(e.target.value)}
              className="select-input"
            >
              {dims.map((d) => (
                <option key={d.dimension} value={d.dimension}>
                  {d.dimension}
                </option>
              ))}
            </select>

            <BenchmarkCharts
              selectedQuery={selectedQuery}
              active={active}
              cdata={cdata}
              activeSystemRows={activeSystemRows}
              activeSystemName={activeSystemName}
              systemCdata={systemCdata}
            />

            <BenchmarkSummaryTable
              bench={bench}
              selectedSystem={selectedSystem}
              setSelectedSystem={setSelectedSystem}
              selectedDetail={selectedDetail}
              setSelectedDetail={setSelectedDetail}
              setSelectedDimension={setSelectedDimension}
            />
          </>
        )}
      </div>
    </div>
  );
}