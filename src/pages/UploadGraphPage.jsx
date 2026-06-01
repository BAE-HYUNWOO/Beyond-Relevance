import { useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import "./UploadGraphPage.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";

export default function UploadGraphPage() {
  const [file, setFile] = useState(null);
  const [topEntities, setTopEntities] = useState(100);
  const [topRelations, setTopRelations] = useState(200);
  const [minSupport, setMinSupport] = useState(2);
  const [maxAbstracts, setMaxAbstracts] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState("");

  const elements = graph ? [...(graph.nodes || []), ...(graph.edges || [])] : [];

  const buildGraph = async () => {
    if (!file) {
      setError("Upload a CSV, TXT, or JSONL file first.");
      return;
    }

    setLoading(true);
    setError("");
    setGraph(null);

    const form = new FormData();
    form.append("file", file);
    form.append("top_entities", String(topEntities));
    form.append("top_relations", String(topRelations));
    form.append("min_support", String(minSupport));
    form.append("max_abstracts", String(maxAbstracts));

    try {
      const res = await fetch(`${API_BASE}/api/ecosystem/build-from-file`, {
        method: "POST",
        body: form,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          typeof data?.detail === "string"
            ? data.detail
            : JSON.stringify(data?.detail || data || `API error: ${res.status}`)
        );
      }

      setGraph(data);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="upload-graph-page">
      <section className="upload-hero">
        <p className="upload-eyebrow">Batch relation graph builder</p>
        <h1>Upload Abstracts and Build Graph</h1>
        <p>
          Upload a CSV, TXT, or JSONL file containing many research abstracts.
          The backend extracts abstract text, runs relation extraction in batch,
          aggregates repeated relations, and returns a filtered ecosystem graph.
        </p>
      </section>

      <section className="upload-card">
        <div className="upload-card-header">
          <div>
            <h2>Upload abstracts</h2>
            <p>
              CSV should contain an <code>abstract</code> column. TXT abstracts
              may be separated by blank lines or <code>---</code>. JSONL should
              have one object per line with an <code>abstract</code> field.
            </p>
          </div>
          <span className="upload-pill">CSV / TXT / JSONL</span>
        </div>

        <label className="upload-dropzone">
          <input
            type="file"
            accept=".csv,.txt,.jsonl,.json"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <strong>{file ? file.name : "Choose file"}</strong>
          <span>Upload CSV, TXT, JSON, or JSONL abstracts.</span>
        </label>

        <div className="upload-filter-grid">
          <label>
            <span>Top entities</span>
            <input
              type="number"
              value={topEntities}
              min="10"
              max="1000"
              onChange={(e) => setTopEntities(e.target.value)}
            />
          </label>

          <label>
            <span>Top relations</span>
            <input
              type="number"
              value={topRelations}
              min="10"
              max="2000"
              onChange={(e) => setTopRelations(e.target.value)}
            />
          </label>

          <label>
            <span>Minimum support</span>
            <input
              type="number"
              value={minSupport}
              min="1"
              max="100"
              onChange={(e) => setMinSupport(e.target.value)}
            />
          </label>

          <label>
            <span>Max abstracts</span>
            <input
              type="number"
              value={maxAbstracts}
              min="1"
              max="10000"
              onChange={(e) => setMaxAbstracts(e.target.value)}
            />
          </label>
        </div>

        <button className="upload-primary-btn" onClick={buildGraph} disabled={loading}>
          {loading ? "Building graph..." : "Upload and Build Graph"}
        </button>

        {error && <pre className="upload-error">{error}</pre>}
      </section>

      <section className="upload-card">
        <div className="upload-graph-header">
          <div>
            <h2>Aggregated ecosystem graph</h2>
            <p>Repeated relations across abstracts increase support and edge weight.</p>
          </div>
          <div className="upload-stats">
            <span>{graph?.num_abstracts || 0} abstracts</span>
            <span>{graph?.num_nodes || 0} nodes</span>
            <span>{graph?.num_edges || 0} edges</span>
          </div>
        </div>

        <div className="upload-graph-canvas">
          {elements.length ? (
            <CytoscapeComponent
              elements={elements}
              style={{ width: "100%", height: "640px" }}
              layout={{ name: "cose", animate: true, fit: true, padding: 60 }}
              stylesheet={[
                {
                  selector: "node",
                  style: {
                    label: "data(label)",
                    "background-color": "data(color)",
                    color: "#111827",
                    "font-size": 8,
                    "text-wrap": "wrap",
                    "text-max-width": 100,
                    width: "mapData(weight, 1, 50, 28, 76)",
                    height: "mapData(weight, 1, 50, 28, 76)",
                  },
                },
                {
                  selector: "edge",
                  style: {
                    label: "data(label)",
                    width: "mapData(support, 1, 20, 1.5, 8)",
                    "line-color": "#64748b",
                    "target-arrow-color": "#64748b",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "font-size": 7,
                    color: "#475569",
                    "text-background-color": "#ffffff",
                    "text-background-opacity": 0.78,
                    "text-background-padding": 2,
                  },
                },
              ]}
            />
          ) : (
            <div className="upload-empty-graph">
              Upload abstracts and build a graph to preview it here.
            </div>
          )}
        </div>
      </section>

      <section className="upload-card">
        <h2>Top relation triples</h2>
        {graph?.triples?.length ? (
          <div className="upload-table-wrap">
            <table className="upload-table">
              <thead>
                <tr>
                  <th>Entity 1</th>
                  <th>Relation</th>
                  <th>Entity 2</th>
                  <th>Support</th>
                </tr>
              </thead>
              <tbody>
                {graph.triples.map((row, idx) => (
                  <tr key={`${row.entity1}-${row.relation}-${row.entity2}-${idx}`}>
                    <td>{row.entity1}</td>
                    <td>{row.relation}</td>
                    <td>{row.entity2}</td>
                    <td>{row.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="upload-empty-text">No triples yet.</p>
        )}
      </section>
    </main>
  );
}
