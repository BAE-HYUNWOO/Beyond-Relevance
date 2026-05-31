import { SPECIAL, DIM_ALIASES } from "./constants";
// ─── CSV 파싱 ─────────────────────────────────────────────
export function parseCSV(text, options = {}) {
    const skipColumns = new Set(
        (options.skipColumns || []).map((x) => String(x).toLowerCase())
    );
    const rows = [];
    let row = [], value = "", insideQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i], n = text[i + 1];
        if (c === '"' && insideQuotes && n === '"') { value += '"'; i++; }
        else if (c === '"') insideQuotes = !insideQuotes;
        else if (c === ',' && !insideQuotes) { row.push(value.trim()); value = ""; }
        else if ((c === '\n' || c === '\r') && !insideQuotes) {
            if (value.length || row.length) { row.push(value.trim()); rows.push(row); row = []; value = ""; }
            if (c === '\r' && n === '\n') i++;
        } else value += c;
    }
    if (value.length || row.length) { row.push(value.trim()); rows.push(row); }
    const headers = (rows[0] || []).map(h =>
        String(h ?? "")
            .replace(/^\uFEFF/, "")
            .trim()
            .toLowerCase()
    );
    return rows.slice(1)
        .filter(r => r.some(x => x !== ""))
        .map((r) =>
            Object.fromEntries(
                headers
                    .map((h, i) => {
                        const key = String(h).trim().toLowerCase();
                        if (skipColumns.has(key)) return null;
                        return [key, r[i] ?? ""];
                    })
                    .filter(Boolean)
            )
        );
}

export function clean(x) {
    const s = String(x ?? "").trim();
    if (!s || SPECIAL.has(s.toLowerCase())) return "Unknown";
    return s;
}
export function normalizeYear(x) {
    const m = String(x ?? "").trim().match(/\d{4}/);
    return m ? m[0] : "Unknown";
}
export function num(x) { const v = Number(x); return isFinite(v) ? v : 0; }
export function getFileName(path) { return path.split("/").pop().replace(".csv", ""); }
export function getSystemGroupName(f) { return String(f).split("_")[0]; }
export function getQueryName(fileName) {
    return fileName
        .replace(/^Real World Distribution_/, "")
        .replace(/_OpenAlex_\d+$/, "")
        .replace(/_\d+$/, "")
        .replace(/_0425$/, "")
        .replace(/_/g, " ")
        .trim();
}

export function detectDims(rows) {
    if (!rows.length) return [];

    const cols = Object.keys(rows[0]).map(c =>
        String(c ?? "")
            .replace(/^\uFEFF/, "")
            .trim()
            .toLowerCase()
    );

    const detected = [];

    cols.forEach(percentCol => {
        if (!percentCol.endsWith(" percentage")) return;

        let dim = percentCol.replace(" percentage", "").trim();

        // 예: "country count percentage" -> "country"
        if (dim.endsWith(" count")) {
            dim = dim.replace(" count", "").trim();
        }

        const valueCol = dim;
        const countCol = `${dim} count`;

        if (
            cols.includes(valueCol) &&
            cols.includes(countCol) &&
            cols.includes(percentCol)
        ) {
            detected.push({
                dimension: dim,
                valueCol,
                countCol,
                percentCol
            });
        }
    });

    return detected;
}

export function getOutputValue(row, dimName, defaultCol) {
    if (dimName === "country") return row["country"] ?? row["country_code"] ?? "";
    if (dimName === "retracted") return row["retracted"] ?? row["is_retracted"] ?? "";
    return row[defaultCol] ?? "";
}

export function findDim(dims, name) {
    const aliases = DIM_ALIASES[name] || [name];
    return dims.find(d => aliases.includes(d.dimension));
}

export function normalizeSystemValue(value, dimName) {
    const s = String(value ?? "").trim();
    if (!s) return "";

    return s;
}

export function aggregateSystemRows(files) {
    const groups = {};
    files.forEach(file => {
        const group = getSystemGroupName(file.fileName);
        if (!groups[group]) groups[group] = [];
        groups[group].push(file);
    });
    return Object.entries(groups).map(([group, files]) => ({
        fileName: group,
        rows: files.flatMap(f => f.rows),
        sourceFiles: files.map(f => f.fileName),
        fileCount: files.length,
    }));
}
