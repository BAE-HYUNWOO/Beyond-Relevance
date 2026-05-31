// ─── 변경 1: 중복 차원 제거 ───────────────────────────────
// 제거: is oa (open access status와 중복)
//       primary domain (4개짜리, 정보량 낮음)
//       source type (type과 거의 중복)
// ──────────────────────────────────────────────────────────
export const DIMENSION_ORDER = [
    "year",
    "cited by",

    "primary domain",
    "primary field",
    "primary subfield",
    "primary topic",

    "authors",
    "institutions",
    "country",

    "publisher",
    "publication venue",
    "source type",
    "type",
    "open access status",
];

export const DIMENSION_GROUP = {
    "year": "Temporal Fidelity",
    "cited by": "Impact Distortion",
    "primary domain": "Topical Concentration",
    "primary field": "Topical Concentration",
    "primary subfield": "Topical Concentration",
    "primary topic": "Topical Concentration",
    "authors": "Authorship Distortion",
    "institutions": "Authorship Distortion",
    "country": "Geographic Fidelity",
    "publisher": "Publication Source Bias",
    "publication venue": "Publication Source Bias",
    "source type": "Publication Source Bias",
    "type": "Publication Source Bias",
    "open access status": "Openness Fidelity",
};

export const CATEGORY_ORDER = [
    "Temporal",
    "Impact",
    "Topical",
    "Authorship",
    "Geographic",
    "Publication Source",
    "Openness",
];

export const CATEGORY_COLUMNS = {
    Temporal: ["year"],
    Impact: ["cited by"],
    Topical: ["primary domain", "primary field", "primary subfield", "primary topic"],
    Authorship: ["authors", "institutions"],
    Geographic: ["country"],
    "Publication Source": ["publisher", "publication venue", "source type", "type"],
    Openness: ["open access status"],
};

// ─── Percentile Bin 정의 ──────────────────────────────────
export const PERCENTILE_BINS = [
    [0.999, 1.001, "Top 0.1%"],
    [0.995, 0.999, "0.1-0.5%"],
    [0.990, 0.995, "0.5-1%"],
    [0.980, 0.990, "1-2%"],
    [0.950, 0.980, "2-5%"],
    [0.900, 0.950, "5-10%"],
    [0.750, 0.900, "10-25%"],
    [0.000, 0.750, "25-100%"],
];

// Real world는 percentile 정의상 uniform
export const PERCENTILE_REAL_DIST = {
    "Top 0.1%": 0.001,
    "0.1-0.5%": 0.004,
    "0.5-1%": 0.005,
    "1-2%": 0.010,
    "2-5%": 0.030,
    "5-10%": 0.050,
    "10-25%": 0.150,
    "25-100%": 0.750,
    "Unknown/Other": 0.0,
};

export const PERCENTILE_BIN_ORDER = [
    "Top 0.1%", "0.1-0.5%", "0.5-1%", "1-2%",
    "2-5%", "5-10%", "10-25%", "25-100%", "Unknown/Other"
];

export const STRUCTURAL_DIMS = new Set([
    "primary topic",
    "primary subfield",
    "publication venue",
    "publisher",
    "authors",
    "institutions",
    "country"
]);

export const BINS = [
    [0, 0.1, "Top 0.1%"],
    [0.1, 0.5, "0.1–0.5%"],
    [0.5, 1, "0.5–1%"],
    [1, 2, "1–2%"],
    [2, 5, "2–5%"],
    [5, 10, "5–10%"],
    [10, 25, "10–25%"],
    [25, 100, "25–100%"]
];

export const BIN_ORDER = [
    "Top 0.1%", "0.1–0.5%", "0.5–1%", "1–2%",
    "2–5%", "5–10%", "10–25%", "25–100%", "Unknown/Other"
];

export const SPECIAL = new Set(["unknown", "null/unknown", "other", "others", "nan", "none", "null", ""]);

export const DIM_ALIASES = {
  country: ["country", "country_code"],
};