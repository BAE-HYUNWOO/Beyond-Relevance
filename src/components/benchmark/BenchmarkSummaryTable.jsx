import { DIMENSION_ORDER } from "../../benchmark/constants";
import DetailedMetricsPanel from "./DetailedMetricsPanel";

export default function BenchmarkSummaryTable({
  bench,
  selectedSystem,
  setSelectedSystem,
  selectedDetail,
  setSelectedDetail,
  setSelectedDimension,
}) {
  if (!bench.length) return null;

  return (
    <div className="table-card">
      <h2 className="chart-title">Benchmark Summary</h2>

      <div className="table-scroll">
        <table className="benchmark-table">
          <thead>
            <tr>
              <th>System</th>
              <th>Files</th>
              <th>Total Score</th>

              {DIMENSION_ORDER.map((d) => (
                <th key={d}>
                  {d}
                  {d === "cited by" ? " ★" : ""}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {bench.map((sys) => {
              const rowMap = {};
              sys.rows.forEach((r) => {
                rowMap[r.dimension] = r.score;
              });

              return (
                <tr
                  key={sys.system}
                  onClick={() => {
                    setSelectedSystem(sys);
                    setSelectedDetail(null);
                  }}
                  style={{
                    cursor: "pointer",
                    background:
                      selectedSystem?.system === sys.system ? "#dbeafe" : "white",
                  }}
                >
                  <td>
                    <b>{sys.system}</b>
                  </td>
                  <td>{sys.fileCount}</td>
                  <td>{sys.total == null ? "-" : sys.total.toFixed(2)}</td>

                  {DIMENSION_ORDER.map((dim) => (
                    <td key={dim}>
                      {rowMap[dim] == null ? "-" : rowMap[dim].toFixed(2)}
                    </td>
                  ))}
                </tr>
              );
            })}

            <tr style={{ background: "#eff6ff", fontWeight: "bold" }}>
              <td>Average</td>
              <td>-</td>
              <td>
                {(
                  bench
                    .map((x) => x.total)
                    .filter((x) => x != null)
                    .reduce((s, x) => s + x, 0) /
                  Math.max(1, bench.filter((x) => x.total != null).length)
                ).toFixed(2)}
              </td>

              {DIMENSION_ORDER.map((dim) => {
                const vals = bench
                  .map((sys) => sys.rows.find((r) => r.dimension === dim)?.score)
                  .filter((v) => v != null);

                const avg = vals.length
                  ? vals.reduce((s, v) => s + v, 0) / vals.length
                  : null;

                return <td key={dim}>{avg == null ? "-" : avg.toFixed(2)}</td>;
              })}
            </tr>

            <tr style={{ background: "#f8fafc" }}>
              <td>
                <b>Std</b>
              </td>
              <td>-</td>
              <td>
                {(() => {
                  const vals = bench.map((x) => x.total).filter((x) => x != null);
                  if (!vals.length) return "-";

                  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
                  const std = Math.sqrt(
                    vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
                  );

                  return std.toFixed(2);
                })()}
              </td>

              {DIMENSION_ORDER.map((dim) => {
                const vals = bench
                  .map((sys) => sys.rows.find((r) => r.dimension === dim)?.score)
                  .filter((v) => v != null);

                if (!vals.length) return <td key={dim}>-</td>;

                const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
                const std = Math.sqrt(
                  vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
                );

                return <td key={dim}>{std.toFixed(2)}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="metric-note">
        ★ cited by: citation percentile bin method. Total score = average of 7
        categories; each category averages its column scores.
      </p>

      {selectedSystem && (
        <DetailedMetricsPanel
          selectedSystem={selectedSystem}
          selectedDetail={selectedDetail}
          setSelectedDetail={setSelectedDetail}
          setSelectedDimension={setSelectedDimension}
        />
      )}
    </div>
  );
}