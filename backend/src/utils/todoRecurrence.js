function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYmdLocal(s) {
  const p = String(s || "").slice(0, 10);
  const [y, m, d] = p.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function nextOccurrence(todoDateStr, frequency) {
  const d = parseYmdLocal(todoDateStr);
  if (!d) return todoDateStr;
  const f = String(frequency || "once").toLowerCase();
  switch (f) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "half_yearly":
      d.setMonth(d.getMonth() + 6);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      return String(todoDateStr).slice(0, 10);
  }
  return formatYmd(d);
}

module.exports = {
  pad2,
  formatYmd,
  parseYmdLocal,
  nextOccurrence,
};
