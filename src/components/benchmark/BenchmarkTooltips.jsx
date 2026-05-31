// ─── Tooltip components ───────────────────────────────────
export function CustomTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div style={{ background: "white", border: "1px solid #ddd", borderRadius: 10, padding: 12, color: "#111", boxShadow: "0 4px 12px rgba(0,0,0,.12)" }}>
            <b>{label}</b>
            <div>Percentage: {(d.percentage * 100).toFixed(3)}%</div>
            <div>Count: {Number(d.count || 0).toLocaleString()}</div>
        </div>
    );
}
export function CompareTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const row = payload[0].payload;

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #ddd",
        borderRadius: 10,
        padding: 12,
        color: "#111",
      }}
    >
      <b>{label}</b>

      <div>
        Real: {(row.real * 100).toFixed(2)}%
      </div>

      <div>
        System: {(row.system * 100).toFixed(2)}%
      </div>

      <div>
        Gap: {(row.gap * 100).toFixed(2)}%
      </div>
    </div>
  );
}
