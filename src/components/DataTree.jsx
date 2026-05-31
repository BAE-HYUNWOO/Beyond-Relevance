export default function DataTree({ items, onOpenFile }) {
  return (
    <div>
      {items.map((item) => (
        <div key={item.path} style={{ marginLeft: 12, marginBottom: 6 }}>
          {item.type === "folder" ? (
            <details open>
              <summary
                style={{
                  cursor: "pointer",
                  fontWeight: 700,
                  color: "#334155",
                  whiteSpace: "nowrap",
                }}
              >
                📁 {item.name}
              </summary>
              <DataTree items={item.children || []} onOpenFile={onOpenFile} />
            </details>
          ) : (
            <div
              onClick={() => onOpenFile(item.path)}
              title={item.path}
              style={{
                cursor: "pointer",
                color: "#111827",
                fontSize: 13,
                padding: "3px 0",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "block",
                maxWidth: "100%",
              }}
            >
              📄 {item.name}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
