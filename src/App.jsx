import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import BenchmarkPage from "./pages/BenchmarkPage";
import IRSystemsPage from "./pages/IRSystemsPage";
import LLMsPage from "./pages/LLMsPage";
import RealWorldPage from "./pages/RealWorldPage";
import SampleDataDownloadPage from "./pages/SampleDataDownloadPage";
import RelationGraphPage from "./pages/RelationGraphPage";
import UploadGraphPage from "./pages/UploadGraphPage";
import EcosystemGraphPage from "./pages/EcosystemGraphPage";
import "./pages/HomePage.css";

function ResearchHeader() {
  const navigate = useNavigate();

  return (
    <header className="rs-header">
      <button className="rs-brand" onClick={() => navigate("/")}>
        <span className="rs-logo" aria-hidden="true" />
        <span>Research Services</span>
      </button>

      <nav className="rs-nav" aria-label="Temporary navigation">
        <button type="button">미정1</button>
        <button type="button">미정2</button>
        <button type="button">미정3</button>
        <button type="button">미정4</button>
      </nav>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="rs-app">
        <ResearchHeader />

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sample-data" element={<SampleDataDownloadPage />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
          <Route path="/ir-systems" element={<IRSystemsPage />} />
          <Route path="/llms" element={<LLMsPage />} />
          <Route path="/real-world" element={<RealWorldPage />} />
          <Route path="/relation-graph" element={<RelationGraphPage />} />
          <Route path="/upload-graph" element={<UploadGraphPage />} />
          <Route path="/ecosystem-graph" element={<EcosystemGraphPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
