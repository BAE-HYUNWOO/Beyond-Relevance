import { useMemo } from "react";

export default function CsvPreview({ csvRows, csvColumns }) {
  const estimatedTableWidth = useMemo(() => {
    return Math.max(900, (csvColumns?.length || 0) * 170);
  }, [csvColumns]);

  return (
    <div
      className="csv-preview-root"
      style={{
        border: "1px solid #cbd5e1",
        borderRadius: 12,
        background: "white",
        overflow: "hidden",
        height: "100%",
        minHeight: 0,
        boxSizing: "border-box",
      }}
    >
      <div
        className="csv-preview-scroll"
        style={{
          width: "100%",
          height: "100%",
          minHeight: 0,
          overflow: "auto",
          scrollbarGutter: "stable both-edges",
          boxSizing: "border-box",
        }}
      >
        <table
          style={{
            minWidth: estimatedTableWidth,
            width: "max-content",
            borderCollapse: "collapse",
            fontSize: 12,
            color: "#0f172a",
            background: "white",
          }}
        >
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: "#f8fafc",
              zIndex: 2,
            }}
          >
            <tr>
              {csvColumns.map((col) => (
                <th
                  key={col}
                  style={{
                    borderBottom: "1px solid #cbd5e1",
                    padding: "9px 10px",
                    textAlign: "left",
                    color: "#0f172a",
                    whiteSpace: "nowrap",
                    fontWeight: 800,
                    minWidth: 140,
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {csvRows.map((row, idx) => (
              <tr
                key={idx}
                style={{
                  borderBottom: "1px solid #e2e8f0",
                  background: idx % 2 === 0 ? "white" : "#f8fafc",
                }}
              >
                {csvColumns.map((col) => (
                  <td
                    key={col}
                    style={{
                      padding: "8px 10px",
                      color: "#111827",
                      verticalAlign: "top",
                      minWidth: 140,
                      maxWidth: 360,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={String(row[col] || "")}
                  >
                    {String(row[col] || "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
