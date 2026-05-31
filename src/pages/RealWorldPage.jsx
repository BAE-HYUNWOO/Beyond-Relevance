import CollectionPageLayout from "../components/CollectionPageLayout";

export default function RealWorldPage() {
  return (
    <CollectionPageLayout
      activeLabel="Real-World"
      title="Real-World Data Collection"
      subtitle="Prepare and inspect real-world scholarly distribution data used as the benchmark reference."
    >
      <div
        style={{
          background: "rgba(255,255,255,0.82)",
          border: "1px solid rgba(226,232,240,0.9)",
          borderRadius: 28,
          padding: 30,
          minHeight: 360,
          boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 28, fontWeight: 900 }}>
          Real-World
        </h2>
        <p style={{ color: "#64748b", lineHeight: 1.7 }}>
          Real-world distribution page 以鍮꾩쨷.
        </p>
      </div>
    </CollectionPageLayout>
  );
}
