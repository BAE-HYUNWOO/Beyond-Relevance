import { NavLink } from "react-router-dom";
import "./CollectionPage.css";

const tabs = [
  { label: "LLMs", path: "/llms" },
  { label: "IR-Systems", path: "/ir-systems" },
  { label: "Real-World", path: "/real-world" },
];

export default function CollectionPageLayout({
  activeLabel = "IR-Systems",
  kicker = "Papers Data Collection",
  title = "Papers Data Collection",
  subtitle = "Collect, inspect, and prepare scholarly paper datasets for downstream benchmark evaluation.",
  children,
}) {
  return (
    <main className="collection-root">
      <div className="collection-bg-orb collection-bg-orb-left" />
      <div className="collection-bg-orb collection-bg-orb-right" />

      <section className="collection-hero">
        {activeLabel && (
        <nav className="collection-tabs" aria-label="Papers data collection modules">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                isActive || activeLabel === tab.label
                  ? "collection-tab active"
                  : "collection-tab"
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        )}

        <div className="collection-kicker">{kicker}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </section>

      <section className="collection-content">
        {children}
      </section>
    </main>
  );
}
