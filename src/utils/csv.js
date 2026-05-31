export function parseCsv(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      current.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      current.push(value);
      rows.push(current);
      current = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || current.length) current.push(value), rows.push(current);

  return rows.filter((row) =>
    row.some((cell) => String(cell).trim() !== "")
  );
}