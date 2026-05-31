export function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getCurrentTime() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}