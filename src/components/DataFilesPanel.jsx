import DataTree from "./DataTree";
import CsvPreview from "./CsvPreview";

export default function DataFilesPanel({
  dataTree,
  selectedFile,
  fileContent,
  csvRows,
  csvColumns,
  fileError,
  openDataFile,
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "420px 1fr",
        gap: 20,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          background: "white",
          color: "#0f172a",
          border: "1px solid #e2e8f0",
          borderRadius: 18,
          padding: 18,
          height: 560,
          overflow: "auto",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 14, fontSize: 16 }}>
          Data Files
        </div>

        <DataTree items={dataTree} onOpenFile={openDataFile} />
      </div>

      <div
        style={{
          background: "white",
          color: "#0f172a",
          border: "1px solid #e2e8f0",
          borderRadius: 18,
          padding: 18,
          height: 560,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            fontWeight: 900,
            marginBottom: 14,
            color: "#0f172a",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={selectedFile || "File Preview"}
        >
          {selectedFile || "File Preview"}
        </div>

        {csvRows.length > 0 ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
            }}
          >
            <CsvPreview csvRows={csvRows} csvColumns={csvColumns} />
          </div>
        ) : fileError ? (
          <pre
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              color: "#dc2626",
              whiteSpace: "pre-wrap",
              margin: 0,
            }}
          >
            {fileError}
          </pre>
        ) : (
          <pre
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              fontFamily: "Consolas, monospace",
              color: "#111827",
            }}
          >
            {fileContent || "Select a file to preview."}
          </pre>
        )}
      </div>
    </section>
  );
}
