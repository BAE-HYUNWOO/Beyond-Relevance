import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { CompareTooltip } from "./BenchmarkTooltips";
import { makeComparisonData } from "../../benchmark/chartUtils";
import { fmt } from "../../benchmark/metrics";

export default function DetailedMetricsPanel({
  selectedSystem,
  selectedDetail,
  setSelectedDetail,
  setSelectedDimension,
}) {
  if (!selectedSystem) return null;

  return (
    <div className="detail-card">
      <h2 className="chart-title">Detailed Metrics: {selectedSystem.system}</h2>

      <div className="table-scroll">
        <table className="benchmark-table">
          <thead>
            <tr>
              <th>Dimension</th>
              <th>Score</th>
              <th>JSD</th>
              <th>TVD</th>
              <th>Entropy Gap</th>
              <th>Elite Gap</th>
              <th>Tail Gap</th>
              <th>Coverage Rate</th>
              <th>Recency Gap</th>
              <th>HHI</th>
            </tr>
          </thead>

          <tbody>
            {selectedSystem.rows.map((r) => (
              <tr
                key={r.dimension}
                onClick={() => {
                  setSelectedDetail(r);
                  setSelectedDimension(r.dimension);
                }}
                style={{
                  cursor: "pointer",
                  background:
                    selectedDetail?.dimension === r.dimension ? "#dbeafe" : "white",
                }}
              >
                <td>
                  <b>{r.dimension}</b>
                </td>
                <td>{r.score == null ? "-" : r.score.toFixed(2)}</td>
                <td>{fmt(r.jsd)}</td>
                <td>{fmt(r.tvd)}</td>
                <td>{fmt(r.entropyGap)}</td>
                <td>{fmt(r.eliteGap)}</td>
                <td>{fmt(r.tailGap)}</td>
                <td>{fmt(r.coverageRate)}</td>
                <td>{fmt(r.recencyGap)}</td>
                <td>{fmt(r.hhiGap)}</td>
              </tr>
            ))}

            <tr style={{ background: "#eff6ff", fontWeight: "bold" }}>
              <td>Average</td>

              {[
                "score",
                "jsd",
                "tvd",
                "entropyGap",
                "eliteGap",
                "tailGap",
                "coverageRate",
                "recencyGap",
                "hhiGap",
              ].map((key) => {
                const vals = selectedSystem.rows
                  .map((r) => r[key])
                  .filter((v) => v != null && !Number.isNaN(v));

                if (!vals.length) return <td key={key}>-</td>;

                const avg = vals.reduce((s, v) => s + v, 0) / vals.length;

                return <td key={key}>{avg.toFixed(4)}</td>;
              })}
            </tr>

            <tr style={{ background: "#f8fafc" }}>
              <td>
                <b>Std</b>
              </td>

              {[
                "score",
                "jsd",
                "tvd",
                "entropyGap",
                "eliteGap",
                "tailGap",
                "coverageRate",
                "recencyGap",
                "hhiGap",
              ].map((key) => {
                const vals = selectedSystem.rows
                  .map((r) => r[key])
                  .filter((v) => v != null && !Number.isNaN(v));

                if (!vals.length) return <td key={key}>-</td>;

                const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
                const std = Math.sqrt(
                  vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
                );

                return <td key={key}>{std.toFixed(4)}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="metric-note">
        Each column score is calculated as the equal-weight average of its
        assigned metrics. Coverage Rate is treated as a positive metric; all
        others are penalty metrics.
      </p>

      {selectedDetail && (
        <div className="detail-card">
          <h2 className="chart-title">
            Dimension Detail: {selectedDetail.dimension}
          </h2>

          {selectedDetail.dimension === "cited by" && (
            <p className="metric-note">
              Comparison of citation percentile bin distributions. Real world is
              uniform by percentile definition.
            </p>
          )}

          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart
                data={makeComparisonData(
                  selectedDetail.realDist,
                  selectedDetail.systemDist,
                  selectedDetail.dimension
                )}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  angle={-35}
                  textAnchor="end"
                  height={140}
                  interval={0}
                  tick={{ fill: "#374151", fontSize: 12 }}
                />
                <YAxis tickFormatter={(v) => `${(v * 100).toFixed(1)}%`} />
                <Tooltip content={<CompareTooltip />} />
                <Bar dataKey="real" fill="#94a3b8" name="Real" />
                <Bar dataKey="system" fill="#2563eb" name="System" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3>Calculation Process</h3>

          <div className="calc-box">
            {selectedDetail.dimension === "cited by" ? (
              <>
                <p>
                  <b>Method:</b> Citation Percentile Bin
                </p>
                <p>
                  <b>Real distribution:</b> uniform by percentile definition.
                </p>
                <p>
                  <b>System distribution:</b> classify uploaded papers'
                  citation percentile values into bins.
                </p>
                <p>
                  <b>JSD:</b> {fmt(selectedDetail.jsd)} | <b>TVD:</b>{" "}
                  {fmt(selectedDetail.tvd)}
                </p>
                <p>
                  <b>Elite Gap:</b>{" "}
                  {selectedDetail.eliteGap != null
                    ? `${(selectedDetail.eliteGap * 100).toFixed(2)}%`
                    : "-"}
                </p>
                <p>
                  <b>Tail Gap:</b>{" "}
                  {selectedDetail.tailGap != null
                    ? `${(selectedDetail.tailGap * 100).toFixed(2)}%`
                    : "-"}
                </p>
                <p>
                  <b>Score:</b>{" "}
                  {selectedDetail.score == null
                    ? "-"
                    : selectedDetail.score.toFixed(2)}
                </p>
              </>
            ) : (
              <>
                <p>
                  <b>1. Real distribution:</b> Based on OpenAlex real-world
                  distribution file.
                </p>
                <p>
                  <b>2. System distribution:</b> Based on uploaded system-output
                  CSV.
                </p>
                <p>
                  <b>3. JSD:</b> {fmt(selectedDetail.jsd)} | <b>TVD:</b>{" "}
                  {fmt(selectedDetail.tvd)}
                </p>

                {selectedDetail.eliteGap != null && (
                  <p>
                    <b>Elite Gap:</b> {fmt(selectedDetail.eliteGap)}
                  </p>
                )}

                {selectedDetail.tailGap != null && (
                  <p>
                    <b>Tail Gap:</b> {fmt(selectedDetail.tailGap)}
                  </p>
                )}

                {selectedDetail.entropyGap != null && (
                  <p>
                    <b>Entropy Gap:</b> {fmt(selectedDetail.entropyGap)}
                  </p>
                )}

                {selectedDetail.hhiGap != null && (
                  <p>
                    <b>HHI:</b> {fmt(selectedDetail.hhiGap)}
                  </p>
                )}

                <p>
                  <b>Score:</b>{" "}
                  {selectedDetail.score == null
                    ? "-"
                    : selectedDetail.score.toFixed(2)}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}