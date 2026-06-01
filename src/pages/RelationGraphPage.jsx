import { useMemo, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import "./RelationGraphPage.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";

export default function RelationGraphPage() {
  const [abstracts, setAbstracts] = useState([""]);
  const [graph, setGraph] = useState({ nodes: [], edges: [], triples: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const elements = useMemo(() => {
    return [...(graph.nodes || []), ...(graph.edges || [])];
  }, [graph]);

  const updateAbstract = (idx, value) => {
    setAbstracts((prev) => prev.map((x, i) => (i === idx ? value : x)));
  };

  const addAbstract = () => {
    setAbstracts((prev) => [...prev, ""]);
  };

  const removeAbstract = (idx) => {
    setAbstracts((prev) => prev.filter((_, i) => i !== idx));
  };

  const extractGraph = async () => {
    setLoading(true);
    setError("");

    try {
      const cleanAbstracts = abstracts.map((x) => x.trim()).filter(Boolean);

      const res = await fetch(`${API_BASE}/api/scierc/extract`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          abstracts: cleanAbstracts,
        }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      setGraph(data);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relation-page">
      <section className="relation-hero">
        <p className="eyebrow">Scientific knowledge graph demo</p>
        <h1>Abstract to relation graph</h1>
        <p>
          Paste one or more research abstracts. The system extracts scientific
          entities and relations using SciBERT + PURE, then visualizes them as a
          graph.
        </p>
      </section>

      <section className="abstract-panel">
        <div className="abstract-panel-header">
          <h2>Research abstracts</h2>
          <button className="add-btn" onClick={addAbstract}>
            + Add abstract
          </button>
        </div>

        <div className="abstract-list">
          {abstracts.map((abstractText, idx) => (
            <article className="abstract-card" key={idx}>
              <div className="abstract-card-header">
                <h3>Abstract {idx + 1}</h3>
                {abstracts.length > 1 && (
                  <button
                    className="delete-btn"
                    onClick={() => removeAbstract(idx)}
                  >
                    Delete
                  </button>
                )}
              </div>

              <textarea
                value={abstractText}
                onChange={(e) => updateAbstract(idx, e.target.value)}
                placeholder="Paste a research abstract here..."
              />
            </article>
          ))}
        </div>

        <button
          className="extract-btn"
          onClick={extractGraph}
          disabled={loading}
        >
          {loading ? "Extracting..." : "Extract graph"}
        </button>

        {error && <div className="error-box">{error}</div>}
      </section>

      <section className="graph-section">
        <div className="graph-header">
          <div>
            <h2>Relation graph</h2>
            <p>
              Nodes represent scientific entities. Edges represent predicted
              relations. Repeated relations across abstracts increase support.
            </p>
          </div>

          <div className="graph-stats">
            <span>{graph.num_nodes || 0} nodes</span>
            <span>{graph.num_edges || 0} edges</span>
            <span>{graph.num_abstracts || 0} abstracts</span>
          </div>
        </div>

        <div className="graph-canvas">
          {elements.length > 0 ? (
            <CytoscapeComponent
              elements={elements}
              style={{ width: "100%", height: "620px" }}
              layout={{
                name: "cose",
                animate: true,
                fit: true,
                padding: 40,
              }}
              stylesheet={[
                {
                  selector: "node",
                  style: {
                    label: "data(label)",
                    "background-color": "data(color)",
                    color: "#111827",
                    "font-size": 9,
                    "text-wrap": "wrap",
                    "text-max-width": 90,
                    width: 34,
                    height: 34,
                  },
                },
                {
                  selector: "edge",
                  style: {
                    label: "data(label)",
                    width: "mapData(support, 1, 5, 1.5, 6)",
                    "line-color": "#64748b",
                    "target-arrow-color": "#64748b",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "font-size": 8,
                    color: "#475569",
                    "text-background-color": "#ffffff",
                    "text-background-opacity": 0.8,
                    "text-background-padding": 2,
                  },
                },
              ]}
            />
          ) : (
            <div className="empty-graph">
              Extract a graph to visualize relations here.
            </div>
          )}
        </div>
      </section>

      <section className="triples-section">
        <h2>Extracted triples</h2>

        {graph.triples?.length ? (
          <div className="triples-table-wrap">
            <table className="triples-table">
              <thead>
                <tr>
                  <th>Entity 1</th>
                  <th>Relation</th>
                  <th>Entity 2</th>
                  <th>Support</th>
                  <th>Documents</th>
                </tr>
              </thead>
              <tbody>
                {graph.triples.map((t, idx) => (
                  <tr key={idx}>
                    <td>{t.entity1}</td>
                    <td>{t.relation}</td>
                    <td>{t.entity2}</td>
                    <td>{t.support}</td>
                    <td>{t.documents?.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-text">No triples yet.</p>
        )}
      </section>
    </main>
  );
}