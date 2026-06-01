import { useState } from "react";
import "./EcosystemGraphPage.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8001";
const DEFAULT_URL = "https://arxiv.org/list/cs.AI/recent";

export default function EcosystemGraphPage() {
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_URL);
  const [maxPapers, setMaxPapers] = useState(100);
  const [delayPerPaper, setDelayPerPaper] = useState(0.2);
  const [showBrowser, setShowBrowser] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function collectAbstracts() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(`${API_BASE}/api/arxiv/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: sourceUrl,
          max_papers: Number(maxPapers),
          delay_per_paper: Number(delayPerPaper),
          show_browser: Boolean(showBrowser),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.detail || `API error: ${response.status}`);
      }

      setResult(data);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="eco-page">
      <section className="eco-hero">
        <p className="eco-eyebrow">Large-scale arXiv abstract collector</p>
        <h1>Research Ecosystem Graph</h1>
        <p>
          Collect large batches of arXiv abstracts from a category page, save them
          as CSV, and use the saved CSV later in the Upload Abstracts and Build
          Graph page.
        </p>
      </section>

      <section className="eco-card">
        <div className="eco-card-header">
          <div>
            <h2>Collect arXiv abstracts</h2>
            <p>
              The backend opens a visible Chrome window, expands the arXiv list
              with <code>?skip=0&amp;show=2000</code>, visits each abstract page,
              extracts title, authors, URL, and abstract text, then saves a CSV.
            </p>
          </div>
          <span className="eco-chip">arXiv crawler</span>
        </div>

        <div className="eco-form-grid">
          <label>
            <span>Source URL</span>
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://arxiv.org/list/cs.AI/recent"
            />
          </label>

          <label>
            <span>Max papers</span>
            <input
              type="number"
              min="1"
              max="10000"
              value={maxPapers}
              onChange={(event) => setMaxPapers(event.target.value)}
            />
          </label>

          <label>
            <span>Delay per paper</span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.1"
              value={delayPerPaper}
              onChange={(event) => setDelayPerPaper(event.target.value)}
            />
          </label>
        </div>

        <label className="eco-checkbox">
          <input
            type="checkbox"
            checked={showBrowser}
            onChange={(event) => setShowBrowser(event.target.checked)}
          />
          <span>Show Chrome window while crawling</span>
        </label>

        <button className="eco-primary-btn" onClick={collectAbstracts} disabled={loading}>
          {loading ? "Collecting abstracts... Chrome should be visible now" : "Collect Abstracts"}
        </button>

        {loading && (
          <div className="eco-running-box">
            Crawling is running in the backend. Watch the Chrome window for real-time page visits.
          </div>
        )}

        {error && <div className="eco-error-box">{error}</div>}

        {result?.success && (
          <div className="eco-result-box">
            <div className="eco-result-stats">
              <span>{result.collected} collected</span>
              <span>{result.requested} requested</span>
              <span>{result.csv_filename}</span>
            </div>

            <a
              className="eco-download-btn"
              href={`${API_BASE}${result.download_url}`}
              target="_blank"
              rel="noreferrer"
            >
              Download collected CSV
            </a>
          </div>
        )}
      </section>

      <section className="eco-card">
        <div className="eco-card-header">
          <div>
            <h2>Preview</h2>
            <p>
              Collected files are saved under <code>data/raw/arxiv_abstracts/</code>.
              The table below shows the first {result?.preview_limit || 0} collected abstracts.
            </p>
          </div>
        </div>

        {result?.papers?.length ? (
          <div className="eco-preview-list">
            {result.papers.map((paper, index) => (
              <article className="eco-preview-card" key={`${paper.paper_id}-${index}`}>
                <div className="eco-preview-meta">
                  <span>{index + 1}</span>
                  <span>{paper.paper_id}</span>
                </div>
                <h3>{paper.title || "Untitled"}</h3>
                {paper.authors && <p className="eco-authors">{paper.authors}</p>}
                <p className="eco-abstract">{paper.abstract}</p>
                <a href={paper.url} target="_blank" rel="noreferrer">
                  Open arXiv page →
                </a>
              </article>
            ))}
          </div>
        ) : (
          <div className="eco-empty-preview">Collected abstracts will appear here.</div>
        )}
      </section>
    </main>
  );
}
