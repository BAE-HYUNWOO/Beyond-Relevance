import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import CollectionPageLayout from "../components/CollectionPageLayout";

const API_BASE = "http://127.0.0.1:8000";

export default function SampleDataDownloadPage() {
  const [dataTree, setDataTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [zippingFolder, setZippingFolder] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadDataTree();
  }, []);

  async function loadDataTree() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/data/tree`);
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.message || "Failed to load data tree.");
      }

      setDataTree(data.tree || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function normalizePath(value) {
    return String(value || "").replace(/\\/g, "/");
  }

  function getNodePath(node, parentPath = "") {
    const rawPath = normalizePath(node?.path);

    if (rawPath) return rawPath;

    const name = node?.name || "";
    return parentPath ? `${parentPath}/${name}` : name;
  }

  function findSampleSystemOutputsNode(nodes) {
    const queue = (nodes || []).map((node) => ({
      node,
      path: getNodePath(node),
    }));

    while (queue.length) {
      const { node, path } = queue.shift();
      const normalized = normalizePath(path).toLowerCase();
      const name = String(node?.name || "").toLowerCase();

      if (
        node?.type !== "file" &&
        (name === "sample_system_outputs" ||
          normalized.endsWith("/sample_system_outputs") ||
          normalized.includes("/sample_system_outputs/"))
      ) {
        return { node, path };
      }

      (node?.children || []).forEach((child) => {
        queue.push({
          node: child,
          path: getNodePath(child, path),
        });
      });
    }

    return null;
  }

  function flattenFiles(node, parentPath = "") {
    const files = [];

    function walk(current, currentParentPath) {
      const currentPath = getNodePath(current, currentParentPath);

      if (current?.type === "file") {
        files.push({
          ...current,
          path: currentPath,
          name: current.name || currentPath.split("/").pop(),
        });
        return;
      }

      (current?.children || []).forEach((child) => {
        walk(child, currentPath);
      });
    }

    walk(node, parentPath);

    return files.filter((file) =>
      /\.(csv|txt|json|md)$/i.test(file.name || file.path || "")
    );
  }

  function formatFolderName(name) {
    return String(name || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function parseFileName(fileName) {
    const baseName = String(fileName || "")
      .replace(/\.(csv|txt|json|md)$/i, "")
      .replace(/_(found|not_found|matched|missing)$/i, "");

    const match = baseName.match(/^(.+?)_(.+?)_(\d{8})_(\d{4})/);

    if (!match) {
      return {
        title: baseName.replace(/_/g, " "),
        meta: "",
      };
    }

    const [, rawModel, rawQuery, rawDate, rawTime] = match;

    const yyyy = rawDate.slice(0, 4);
    const mm = rawDate.slice(4, 6);
    const dd = rawDate.slice(6, 8);
    const hh = rawTime.slice(0, 2);
    const min = rawTime.slice(2, 4);

    return {
      title: `${rawModel.replace(/_/g, " ")} · ${rawQuery.replace(/_/g, " ")}`,
      meta: `${yyyy}/${mm}/${dd} ${hh}:${min}`,
    };
  }

  async function fetchFileText(path) {
    const res = await fetch(
      `${API_BASE}/api/data/file?path=${encodeURIComponent(path)}`
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Failed to read ${path}`);
    }

    return res.text();
  }

  async function downloadFile(path) {
    const text = await fetchFileText(path);

    const blob = new Blob([text], {
      type: path.toLowerCase().endsWith(".csv")
        ? "text/csv;charset=utf-8"
        : "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = path.split("/").pop() || "download.csv";

    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  async function downloadFolderZip(folder) {
    if (!folder?.files?.length || zippingFolder) return;

    setZippingFolder(folder.name);
    setError("");

    try {
      const zip = new JSZip();

      for (const file of folder.files) {
        const text = await fetchFileText(file.path);
        zip.file(file.name || file.path.split("/").pop(), text);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = `${folder.name || "sample_system_outputs"}.zip`;

      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setZippingFolder("");
    }
  }

  const folders = useMemo(() => {
    const sampleRoot = findSampleSystemOutputsNode(dataTree);

    if (!sampleRoot?.node?.children?.length) return [];

    return sampleRoot.node.children
      .filter((child) => child.type !== "file")
      .map((folderNode) => {
        const folderPath = getNodePath(folderNode, sampleRoot.path);
        const files = flattenFiles(folderNode, folderPath);

        return {
          name: folderNode.name,
          path: folderPath,
          files,
        };
      })
      .filter((folder) => folder.files.length > 0);
  }, [dataTree]);

  return (
    <CollectionPageLayout
      activeLabel=""
      title="Sample Data Download"
      subtitle="Browse sample_system_outputs by subfolder and download individual files or folder ZIP archives."
    >
      <div
        style={{
          background: "rgba(255,255,255,0.82)",
          border: "1px solid rgba(226,232,240,0.9)",
          borderRadius: 28,
          padding: 30,
          boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            marginBottom: 22,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>
              Sample System Outputs
            </h2>

            <div
              style={{
                marginTop: 6,
                color: "#64748b",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              C:/Users/samsung-user/Desktop/beyond-relevance/src/data/sample_system_outputs
            </div>
          </div>

          <button
            onClick={loadDataTree}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "none",
              background: loading ? "#94a3b8" : "#2563eb",
              color: "white",
              fontWeight: 800,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <pre
            style={{
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              borderRadius: 14,
              padding: 16,
              whiteSpace: "pre-wrap",
              marginBottom: 20,
            }}
          >
            {error}
          </pre>
        )}

        {folders.length ? (
          <div style={{ display: "grid", gap: 24 }}>
            {folders.map((folder) => (
              <section
                key={folder.path}
                style={{
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 20,
                  padding: 20,
                  boxShadow: "0 8px 24px rgba(15,23,42,0.04)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 16,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 21,
                        fontWeight: 900,
                        color: "#111827",
                      }}
                    >
                      📁 {formatFolderName(folder.name)}
                    </h3>

                    <div
                      style={{
                        marginTop: 5,
                        color: "#94a3b8",
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {folder.files.length} file(s)
                    </div>
                  </div>

                  <button
                    onClick={() => downloadFolderZip(folder)}
                    disabled={zippingFolder === folder.name}
                    style={{
                      padding: "9px 13px",
                      borderRadius: 11,
                      border: "none",
                      background:
                        zippingFolder === folder.name ? "#94a3b8" : "#111827",
                      color: "white",
                      fontWeight: 850,
                      cursor:
                        zippingFolder === folder.name ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {zippingFolder === folder.name ? "Zipping..." : "Download ZIP"}
                  </button>
                </div>

                <div
                  data-file-grid
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
                  {folder.files.map((file) => {
                    const info = parseFileName(file.name);

                    return (
                      <div
                        key={file.path}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "11px 12px",
                          border: "1px solid #eef2f7",
                          borderRadius: 14,
                          background: "#ffffff",
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            minWidth: 0,
                            display: "grid",
                            gap: 3,
                            lineHeight: 1.25,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              color: "#0f172a",
                              fontWeight: 900,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={file.name}
                          >
                            {info.title}
                          </div>

                          {info.meta && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                fontWeight: 700,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {info.meta}
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => downloadFile(file.path)}
                          style={{
                            flexShrink: 0,
                            padding: "7px 9px",
                            borderRadius: 9,
                            border: "1px solid #dbeafe",
                            background: "#eff6ff",
                            color: "#2563eb",
                            fontSize: 12,
                            fontWeight: 850,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Download
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: 24,
              border: "1px dashed #cbd5e1",
              borderRadius: 16,
              color: "#94a3b8",
              textAlign: "center",
              background: "#f8fafc",
            }}
          >
            {loading
              ? "Loading files..."
              : "No downloadable files found in sample_system_outputs."}
          </div>
        )}
      </div>

      <style>
        {`
          @media (max-width: 1400px) {
            [data-file-grid] {
              grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            }
          }

          @media (max-width: 1150px) {
            [data-file-grid] {
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            }
          }

          @media (max-width: 850px) {
            [data-file-grid] {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
          }

          @media (max-width: 560px) {
            [data-file-grid] {
              grid-template-columns: 1fr !important;
            }
          }
        `}
      </style>
    </CollectionPageLayout>
  );
}
