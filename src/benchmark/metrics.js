import {
  DIMENSION_ORDER,
  DIMENSION_GROUP,
  CATEGORY_ORDER,
  CATEGORY_COLUMNS,
  PERCENTILE_BINS,
  PERCENTILE_REAL_DIST,
  PERCENTILE_BIN_ORDER,
  STRUCTURAL_DIMS,
  BINS,
  BIN_ORDER,
  SPECIAL,
} from "./constants";

import {
  clean,
  normalizeYear,
  num,
  getOutputValue,
  findDim,
  normalizeSystemValue,
} from "./csvUtils";


// ─── Percentile bin 할당 ──────────────────────────────────
export function assignPercentileBin(pStr) {
    const s = (pStr || "").trim();
    if (!s) return "Unknown/Other";
    try {
        const pv = parseFloat(s);
        if (!isFinite(pv)) return "Unknown/Other";
        if (pv >= 0.999) return "Top 0.1%";
        for (const [lo, hi, label] of PERCENTILE_BINS) {
            if (pv >= lo && pv < hi) return label;
        }
        return "25-100%";
    } catch {
        return "Unknown/Other";
    }
}


export function normalize(map, order = null) {
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    const keys = order || Object.keys(map);
    const out = {};
    keys.forEach(k => { out[k] = total > 0 ? (map[k] || 0) / total : 0; });
    return out;
}
export function distFromPairs(pairs, order = null) {
    const counts = {};
    pairs.forEach(([k, v]) => { counts[k] = (counts[k] || 0) + v; });
    return normalize(counts, order);
}
export function entropy(d) {
    return Object.values(d).reduce((s, p) => p > 0 ? s - p * Math.log2(p) : s, 0);
}
export function normalizedEntropyGap(p, q) {
    const keys = [...new Set([...Object.keys(p || {}), ...Object.keys(q || {})])];
    const k = keys.length;
    if (k <= 1) return 0;
    return (entropy(q) - entropy(p)) / Math.log2(k);
}


export function recentShareFromDist(dist, recentStartYear = 2021) {
    let recent = 0, total = 0;

    Object.entries(dist || {}).forEach(([year, p]) => {
        const y = Number(year);
        if (!isFinite(y)) return;
        total += p;
        if (y >= recentStartYear) recent += p;
    });

    return total > 0 ? recent / total : 0;
}

export function hhi(d) { return Object.values(d).reduce((s, p) => s + p * p, 0); }
export function gini(d) {
    const arr = Object.values(d).sort((a, b) => a - b);
    const n = arr.length;
    if (!n) return 0;
    const sum = arr.reduce((a, b) => a + b, 0);
    if (!sum) return 0;
    let acc = 0;
    arr.forEach((v, i) => acc += (i + 1) * v);
    return (2 * acc) / (n * sum) - (n + 1) / n;
}
export function jsd(p, q) {
    const keys = [...new Set([...Object.keys(p), ...Object.keys(q)])];
    const m = {};
    keys.forEach(k => { m[k] = ((p[k] || 0) + (q[k] || 0)) / 2; });
    const kl = (a, b) => keys.reduce((s, k) => {
        const x = a[k] || 0, y = b[k] || 0;
        return x > 0 && y > 0 ? s + x * Math.log2(x / y) : s;
    }, 0);
    return 0.5 * kl(p, m) + 0.5 * kl(q, m);
}
export function tvd(p, q) {
    const keys = [...new Set([...Object.keys(p), ...Object.keys(q)])];
    return 0.5 * keys.reduce((s, k) => s + Math.abs((p[k] || 0) - (q[k] || 0)), 0);
}
export function assignRankBin(rankPercentile) {
    for (const [low, high, label] of BINS) {
        if (rankPercentile > low && rankPercentile <= high) return label;
    }
    return "25–100%";
}
export function shareOf(dist, bins) {
    return bins.reduce((s, b) => s + (dist[b] || 0), 0);
}
export function buildTop80SetFromRealDist(realDist) {
    const entries = Object.entries(realDist || {})
        .filter(([k, v]) => k !== "Unknown" && k !== "Unknown/Other" && v > 0)
        .sort((a, b) => b[1] - a[1]);

    const topSet = new Set();
    let cum = 0;
    let cutoffValue = null;

    for (const [k, v] of entries) {
        if (cum < 0.8) {
            topSet.add(k);
            cum += v;
            cutoffValue = v;
        } else if (cutoffValue != null && v === cutoffValue) {
            topSet.add(k);
            cum += v;
        } else {
            break;
        }
    }

    return topSet;
}

export function shareInSet(dist, keySet) {
    return [...keySet].reduce((s, k) => s + (dist?.[k] || 0), 0);
}

export function shareOutsideSet(dist, keySet) {
    return Object.entries(dist || {}).reduce((s, [k, v]) => {
        if (k === "Unknown" || k === "Unknown/Other") return s;
        return keySet.has(k) ? s : s + v;
    }, 0);
}

export function coverageRateByTopSet(systemDist, topSet) {
    if (!topSet.size) return null;
    let covered = 0;

    topSet.forEach(k => {
        if ((systemDist?.[k] || 0) > 0) covered += 1;
    });

    return covered / topSet.size;
}

export function metricScoreFromPenalty(value, cap = 1) {
    if (value == null || !isFinite(value)) return null;
    return Math.max(0, 100 * (1 - Math.min(Math.abs(value), cap) / cap));
}

export function metricScoreFromPositive(value) {
    if (value == null || !isFinite(value)) return null;
    return Math.max(0, Math.min(100, value * 100));
}

export function columnScore(metrics) {
    const scores = metrics
        .map(m => {
            if (m.type === "positive") {
                return metricScoreFromPositive(m.value);
            }
            return metricScoreFromPenalty(m.value, m.cap ?? 1);
        })
        .filter(v => v != null);

    if (!scores.length) return null;

    return scores.reduce((s, v) => s + v, 0) / scores.length;
}

// ─── 변경 2: cited by → percentile bin 방식 ──────────────
export function citationPercentileBenchmark(outRows) {
    const pairs = [];
    outRows.forEach(r => {
        const bin = assignPercentileBin(
            r["citation percentile (by year/subfield)"] || ""
        );
        pairs.push([bin, 1]);
    });
    const sysDist = distFromPairs(pairs, PERCENTILE_BIN_ORDER);

    const keys = PERCENTILE_BIN_ORDER.filter(b => b !== "Unknown/Other");
    const realClean = Object.fromEntries(keys.map(k => [k, PERCENTILE_REAL_DIST[k] || 0]));
    const sysClean = Object.fromEntries(keys.map(k => [k, sysDist[k] || 0]));

    const tR = Object.values(realClean).reduce((a, b) => a + b, 0);
    const tS = Object.values(sysClean).reduce((a, b) => a + b, 0);
    const realNorm = Object.fromEntries(keys.map(k => [k, tR > 0 ? realClean[k] / tR : 0]));
    const sysNorm = Object.fromEntries(keys.map(k => [k, tS > 0 ? sysClean[k] / tS : 0]));

    const j = jsd(sysNorm, realNorm);
    const t = tvd(sysNorm, realNorm);

    const eliteBins = ["Top 0.1%", "0.1-0.5%", "0.5-1%"];
    const tailBins = ["10-25%", "25-100%"];
    const eliteGap = shareOf(sysDist, eliteBins) - shareOf(PERCENTILE_REAL_DIST, eliteBins);
    const tailGap = shareOf(sysDist, tailBins) - shareOf(PERCENTILE_REAL_DIST, tailBins);
    const unknownGap = (sysDist["Unknown/Other"] || 0) - (PERCENTILE_REAL_DIST["Unknown/Other"] || 0);

    const score = columnScore([
        { name: "JSD", value: j },
        { name: "TVD", value: t },
        { name: "Elite Gap", value: eliteGap },
        { name: "Tail Gap", value: tailGap },
    ]);

    return {
        dimension: "cited by",
        mode: "Percentile Bin",
        group: "Impact Distortion",
        score,
        jsd: j,
        tvd: t,
        entropyGap: null,
        giniGap: null,
        hhiGap: null,
        eliteGap,
        tailGap,
        unknownGap,
        realDist: PERCENTILE_REAL_DIST,
        systemDist: sysDist,
    };
}

// ─── 나머지 benchmark 함수들 ──────────────────────────────
export function realCategoryDist(realRows, dim) {
    const pairs = [];
    realRows.forEach(r => {
        const k = dim.dimension === "year" ? normalizeYear(r[dim.valueCol]) : clean(r[dim.valueCol]);
        const c = num(r[dim.countCol]);
        if (k !== "Unknown" && c > 0) pairs.push([k, c]);
    });
    return distFromPairs(pairs);
}
export function outputCategoryDist(outRows, col, dimension = "") {
    const pairs = [];

    outRows.forEach(r => {
        const raw = getOutputValue(r, dimension, col);

        let vals = (dimension === "country" || dimension === "authors" || dimension === "institutions")
            ? String(raw ?? "").split(";").map(x => x.trim()).filter(Boolean)
            : [raw];

        vals.forEach(v => {
            let normalized = normalizeSystemValue(v, dimension);

            const k = dimension === "year"
                ? normalizeYear(normalized)
                : clean(normalized);

            if (k !== "Unknown" && k !== "null/unknown") {
                pairs.push([k, 1]);
            }
        });
    });

    return distFromPairs(pairs);
}
export function buildStructuralReference(realRows, dim) {
    const normal = [], special = [];
    realRows.forEach(r => {
        const value = clean(r[dim.valueCol]);
        const count = num(r[dim.countCol]);
        if (count <= 0) return;
        if (SPECIAL.has(value.toLowerCase()) || value === "Unknown") special.push({ value, count });
        else normal.push({ value, count });
    });
    normal.sort((a, b) => b.count - a.count);
    const mapping = {};
    const n = normal.length;
    normal.forEach((x, i) => { mapping[x.value] = assignRankBin((i + 1) / n * 100); });
    special.forEach(x => { mapping[x.value] = "Unknown/Other"; });
    const realPairs = [];
    normal.forEach(x => realPairs.push([mapping[x.value], x.count]));
    special.forEach(x => realPairs.push(["Unknown/Other", x.count]));
    return { mapping, realBinDist: distFromPairs(realPairs, BIN_ORDER) };
}
export function outputStructuralDist(outRows, col, mapping, dimName = "") {
    const pairs = [];

    outRows.forEach(r => {
        const raw = getOutputValue(r, dimName || col, col);

        let vals = (dimName === "country" || col === "institutions" || col === "authors")
            ? String(raw ?? "").split(";").map(x => x.trim()).filter(Boolean)
            : [raw];

        if (!vals.length) vals = ["Unknown"];

        vals.forEach(v => {
            const normalized = normalizeSystemValue(v, dimName || col);

            const key = clean(normalized);

            const bin = (SPECIAL.has(key.toLowerCase()) || key === "Unknown")
                ? "Unknown/Other"
                : (mapping[key] || "Unknown/Other");

            pairs.push([bin, 1]);
        });
    });

    return distFromPairs(pairs, BIN_ORDER);
}

export function benchmark(realRows, outRows, dims) {
    return DIMENSION_ORDER.map(name => {
        if (name === "cited by") {
            return citationPercentileBenchmark(outRows);
        }

        const dim = findDim(dims, name);
        if (!dim) return { dimension: name, group: DIMENSION_GROUP[name] || "", score: null };

        if (STRUCTURAL_DIMS.has(name)) {
            const p = realCategoryDist(realRows, dim);
            const q = outputCategoryDist(outRows, dim.valueCol, name);

            const j = jsd(q, p);
            const t = tvd(q, p);
            const entGap = normalizedEntropyGap(p, q);

            const top80Set = buildTop80SetFromRealDist(p);

            const eliteGap = shareInSet(q, top80Set) - shareInSet(p, top80Set);
            const tailGap = shareOutsideSet(q, top80Set) - shareOutsideSet(p, top80Set);

            const coverageRate = name === "country"
                ? coverageRateByTopSet(q, top80Set)
                : null;
            const hhiValue = name === "authors" ? hhi(q) : null;

            const score = name === "authors"
                ? columnScore([
                    { name: "JSD", value: j },
                    { name: "TVD", value: t },
                    { name: "HHI", value: hhiValue },
                    { name: "Elite Gap", value: eliteGap },
                    { name: "Tail Gap", value: tailGap },
                ])
                : name === "country"
                    ? columnScore([
                        { name: "JSD", value: j },
                        { name: "TVD", value: t },
                        { name: "Entropy Gap", value: entGap },
                        { name: "Elite Gap", value: eliteGap },
                        { name: "Tail Gap", value: tailGap },
                        { name: "Coverage Rate", value: coverageRate, type: "positive" },
                    ])
                    : columnScore([
                        { name: "JSD", value: j },
                        { name: "TVD", value: t },
                        { name: "Entropy Gap", value: entGap },
                        { name: "Elite Gap", value: eliteGap },
                        { name: "Tail Gap", value: tailGap },
                    ]);

            return {
                dimension: name,
                mode: name === "authors" ? "Full Distribution + HHI" : "Top80 Coverage Distribution",
                group: DIMENSION_GROUP[name] || "",
                score,
                jsd: j,
                tvd: t,
                entropyGap: name === "authors" ? null : entGap,
                giniGap: null,
                hhiGap: hhiValue,
                eliteGap,
                tailGap,
                unknownGap: null,
                coverageRate,
                recencyGap: null,
                realDist: p,
                systemDist: q,
            };
        }

        const p = realCategoryDist(realRows, dim);
        const q = outputCategoryDist(outRows, dim.valueCol, name);

        const j = jsd(q, p);
        const t = tvd(q, p);
        const entGap = normalizedEntropyGap(p, q);
        const top80Set = buildTop80SetFromRealDist(p);

        const coverageDims = new Set([
            "primary domain",
            "primary field",
            "source type",
            "type",
            "open access status",
            "country"
        ]);

        const coverageRate = coverageDims.has(name)
            ? coverageRateByTopSet(q, top80Set)
            : null;

        let recencyGap = null;
        let score = null;

        if (name === "year") {
            const realRecent = recentShareFromDist(p, 2021);
            const sysRecent = recentShareFromDist(q, 2021);
            recencyGap = sysRecent - realRecent;

            score = columnScore([
                { name: "JSD", value: j },
                { name: "TVD", value: t },
                { name: "Entropy Gap", value: entGap },
                { name: "Recency Gap", value: recencyGap },
            ]);
        } else if (name === "primary domain") {
            score = columnScore([
                { name: "JSD", value: j },
                { name: "TVD", value: t },
                { name: "Coverage Rate", value: coverageRate, type: "positive" },
            ]);
        } else if (
            name === "primary field" ||
            name === "source type" ||
            name === "type" ||
            name === "open access status"
        ) {
            score = columnScore([
                { name: "JSD", value: j },
                { name: "TVD", value: t },
                { name: "Entropy Gap", value: entGap },
                { name: "Coverage Rate", value: coverageRate, type: "positive" },
            ]);
        } else {
            score = columnScore([
                { name: "JSD", value: j },
                { name: "TVD", value: t },
                { name: "Entropy Gap", value: entGap },
            ]);
        }

        return {
            dimension: name,
            mode: name === "year" ? "Year + Recency" : "Category Distribution",
            group: DIMENSION_GROUP[name] || "",
            score,
            jsd: j,
            tvd: t,
            entropyGap: name === "primary domain" ? null : entGap,
            giniGap: null,
            hhiGap: null,
            eliteGap: null,
            tailGap: null,
            unknownGap: null,
            coverageRate,
            recencyGap,
            realDist: p,
            systemDist: q,
        };
    });
}

export function fmt(x) { return x == null || !isFinite(x) ? "-" : x.toFixed(4); }
