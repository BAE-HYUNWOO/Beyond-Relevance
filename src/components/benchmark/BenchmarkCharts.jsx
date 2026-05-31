import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { CustomTooltip } from "./BenchmarkTooltips";

export default function BenchmarkCharts({
  selectedQuery,
  active,
  cdata,
  activeSystemRows,
  activeSystemName,
  systemCdata,
}) {
  return (
    <div className="chart-card">
      <h2 className="chart-title">
        {selectedQuery} — {active?.dimension} Distribution
      </h2>

      <div style={{ overflowX: "auto", paddingBottom: 8 }}>
        <div style={{ minWidth: Math.max(900, cdata.length * 70), height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cdata}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                angle={-35}
                textAnchor="end"
                height={90}
                interval={0}
                tick={{ fill: "#374151", fontSize: 11 }}
              />
              <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="percentage" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {activeSystemRows.length > 0 && (
        <>
          <h3 style={{ marginTop: 18 }}>
            Uploaded Output — {activeSystemName}
            {active?.dimension === "cited by" && (
              <span style={{ fontSize: 12, fontWeight: 400, color: "#6b7280", marginLeft: 8 }}>
                (citation percentile bin method)
              </span>
            )}
          </h3>

          <div style={{ overflowX: "auto", paddingBottom: 8 }}>
            <div style={{ minWidth: Math.max(900, systemCdata.length * 70), height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={systemCdata}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    angle={-35}
                    textAnchor="end"
                    height={90}
                    interval={0}
                    tick={{ fill: "#374151", fontSize: 11 }}
                  />
                  <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="percentage" fill="#16a34a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}