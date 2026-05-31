import { useNavigate } from "react-router-dom";
import "./HomePage.css";

export default function HomePage() {
  const navigate = useNavigate();

  const collectionLinks = [
    {
      label: "IR Systems",
      path: "/ir-systems",
      description: "Collect candidate papers from retrieval systems.",
    },
    {
      label: "LLMs",
      path: "/llms",
      description: "Run LLM-based paper title generation and collection.",
    },
    {
      label: "Real World",
      path: "/real-world",
      description: "Prepare real-world scholarly distribution data.",
    },
  ];

  function openCollectionDefault(event) {
    if (event.target.closest("button")) return;
    navigate("/ir-systems");
  }

  return (
    <main className="rs-main">
      <section className="rs-hero">
        <div className="rs-kicker">Research Workflow Platform</div>
        <h1>Research Services</h1>
        <p>
          A clean workspace for benchmarking scholarly recommendation outputs,
          collecting paper datasets, and downloading sample research data.
        </p>
      </section>

      <section className="rs-service-grid three" aria-label="Research service cards">
        <article
          className="rs-service-card"
          role="button"
          tabIndex={0}
          onClick={() => navigate("/benchmark")}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate("/benchmark");
          }}
        >
          <div className="rs-card-topline">
            <span className="rs-card-index">01</span>
          </div>

          <h2>Distributional Fidelity Benchmark</h2>
          <p>
            Upload system outputs and compare them against real-world scholarly
            distributions across bibliographic dimensions.
          </p>

          <div className="rs-card-footer">
            <span>Open Benchmark</span>
            <span aria-hidden="true">→</span>
          </div>
        </article>

        <article
          className="rs-service-card"
          role="button"
          tabIndex={0}
          onClick={openCollectionDefault}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate("/ir-systems");
          }}
        >
          <div className="rs-card-topline">
            <span className="rs-card-index">02</span>
          </div>

          <h2>Papers Data Collection</h2>
          <p>
            Move to one of the collection modules for IR systems, LLM outputs,
            or real-world distribution data.
          </p>

          <div className="rs-collection-actions">
            {collectionLinks.map((item) => (
              <button
                key={item.path}
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(item.path);
                }}
                title={item.description}
              >
                {item.label}
              </button>
            ))}
          </div>
        </article>

        <article
          className="rs-service-card"
          role="button"
          tabIndex={0}
          onClick={() => navigate("/sample-data")}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate("/sample-data");
          }}
        >
          <div className="rs-card-topline">
            <span className="rs-card-index">03</span>
          </div>

          <h2>Sample Data Download</h2>
          <p>
            Browse all available sample/data files and download CSV, TXT, JSON,
            or Markdown artifacts individually.
          </p>

          <div className="rs-card-footer">
            <span>Open Downloads</span>
            <span aria-hidden="true">→</span>
          </div>
        </article>

        <article
          className="rs-service-card rs-service-card-soft"
          role="button"
          tabIndex={0}
          onClick={() => navigate("/relation-graph")}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate("/relation-graph");
          }}
        >
          <div className="rs-card-topline">
            <span className="rs-card-index">04</span>
            <span className="rs-card-chip">SciBERT + PURE</span>
          </div>

          <h2>Scientific Relation Graph</h2>
          <p>
            Paste one or more abstracts, extract scientific entities and
            relations, then visualize them as interactive knowledge graphs.
          </p>

          <div className="rs-card-footer">
            <span>Open Relation Graph</span>
            <span aria-hidden="true">→</span>
          </div>
        </article>

        <article
          className="rs-service-card rs-service-card-soft"
          role="button"
          tabIndex={0}
          onClick={() => navigate("/upload-graph")}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate("/upload-graph");
          }}
        >
          <div className="rs-card-topline">
            <span className="rs-card-index">05</span>
            <span className="rs-card-chip">CSV / TXT / JSONL</span>
          </div>

          <h2>Upload Abstracts and Build Graph</h2>
          <p>
            Upload CSV, TXT, or JSONL files containing many abstracts, extract
            relations in batch, and build a filtered ecosystem-level graph.
          </p>

          <div className="rs-card-footer">
            <span>Open Upload Graph</span>
            <span aria-hidden="true">→</span>
          </div>
        </article>

        <article
          className="rs-service-card rs-service-card-soft"
          role="button"
          tabIndex={0}
          onClick={() => navigate("/ecosystem-graph")}
          onKeyDown={(event) => {
            if (event.key === "Enter") navigate("/ecosystem-graph");
          }}
        >
          <div className="rs-card-topline">
            <span className="rs-card-index">06</span>
            <span className="rs-card-chip">arXiv crawler</span>
          </div>

          <h2>Research Ecosystem Graph</h2>
          <p>
            Collect large batches of arXiv abstracts from a category page and
            save them as CSV, TXT, JSON, and JSONL for later graph generation.
          </p>

          <div className="rs-card-footer">
            <span>Open arXiv Collector</span>
            <span aria-hidden="true">→</span>
          </div>
        </article>
      </section>
    </main>
  );
}
