import { PERCENTILE_BIN_ORDER } from "./constants";
import { assignPercentileBin } from "./metrics";
import { clean, normalizeYear, num } from "./csvUtils";

// ─── Chart helpers ────────────────────────────────────────
export function chartData(rows, dim, topN = 20) {
    if (!dim) return [];
    const grouped = {};
    rows.forEach(r => {
        const name = dim.dimension === "year" ? normalizeYear(r[dim.valueCol]) : clean(r[dim.valueCol]);
        const count = num(r[dim.countCol]);
        const percentage = num(r[dim.percentCol]);
        if (!grouped[name]) grouped[name] = { name, count: 0, percentage: 0 };
        grouped[name].count += count;
        grouped[name].percentage += percentage;
    });
    return Object.values(grouped)
        .filter(r => r.count > 0 || r.percentage > 0)
        .sort((a, b) => {
            if (dim.dimension === "year") return Number(b.name) - Number(a.name);
            if (a.name === "Unknown") return 1;
            if (b.name === "Unknown") return -1;
            return b.percentage - a.percentage;
        })
        .slice(0, dim.dimension === "year" ? 999 : topN);
}

export function outputChartData(rows, dim, topN = 20) {
    if (!rows.length || !dim) return [];
    if (dim.dimension === "cited by") {
        // percentile bin 분포 차트
        const binCounts = Object.fromEntries(PERCENTILE_BIN_ORDER.map(b => [b, 0]));
        rows.forEach(r => {
            const bin = assignPercentileBin(r["citation percentile (by year/subfield)"] || "");
            binCounts[bin] = (binCounts[bin] || 0) + 1;
        });
        const total = rows.length;
        return PERCENTILE_BIN_ORDER.map(name => ({
            name,
            count: binCounts[name] || 0,
            percentage: total > 0 ? (binCounts[name] || 0) / total : 0,
        }));
    }
    const grouped = {};
    rows.forEach(r => {

        let vals =
            dim.dimension === "country" ||
                dim.dimension === "authors" ||
                dim.dimension === "institutions"
                ? String(r[dim.valueCol] ?? "")
                    .split(";")
                    .map(x => x.trim())
                    .filter(Boolean)
                : [r[dim.valueCol]];

        vals.forEach(v => {
            const value =
                dim.dimension === "year"
                    ? normalizeYear(v)
                    : clean(v);

            if (value === "Unknown") return;

            grouped[value] = (grouped[value] || 0) + 1;
        });

    });
    const total = Object.values(grouped).reduce((a, b) => a + b, 0);
    return Object.entries(grouped)
        .map(([name, count]) => ({ name, count, percentage: total > 0 ? count / total : 0 }))
        .sort((a, b) => dim.dimension === "year" ? Number(b.name) - Number(a.name) : b.percentage - a.percentage)
        .slice(0, dim.dimension === "year" ? 999 : topN);
}

export function makeComparisonData(realDist, systemDist, dimension = "") {
    const keys = [...new Set([...Object.keys(realDist || {}), ...Object.keys(systemDist || {})])];
    const rows = keys.map(k => ({
        name: k,
        real: realDist?.[k] || 0,
        system: systemDist?.[k] || 0,
        gap: (systemDist?.[k] || 0) - (realDist?.[k] || 0),
        isPercentileBin: dimension === "cited by",
    }));
    if (dimension === "cited by") {
        return PERCENTILE_BIN_ORDER.map(b => rows.find(r => r.name === b) || { name: b, real: 0, system: 0, gap: 0 });
    }
    return rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 30);
}
