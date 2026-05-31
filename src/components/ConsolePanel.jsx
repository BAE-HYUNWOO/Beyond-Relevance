export default function ConsolePanel({ mergeLog, mergeError }) {
  return (
    <div
      style={{
        background: "#020617",
        color: "#e2e8f0",
        borderRadius: 18,
        padding: 20,
        width: "100%",
        height: "100%",
        minHeight: 0,
        maxHeight: "100%",
        overflow: "auto",
        resize: "none",
        boxSizing: "border-box",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
      }}
    >
      <div style={{ color: "#93c5fd", fontWeight: 900, marginBottom: 12 }}>
        Console Output
      </div>

      {mergeLog && (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {mergeLog}
        </pre>
      )}

      {mergeError && (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            color: "#fecaca",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {mergeError}
        </pre>
      )}

      {!mergeLog && !mergeError && (
        <div style={{ color: "#94a3b8" }}>No logs yet.</div>
      )}
    </div>
  );
}
