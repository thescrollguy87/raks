// A tiny, dependency-free CSV writer. Handles the two things that actually
// break naive CSV generation: values containing commas/quotes/newlines
// (quoted + escaped per RFC 4180), and a leading BOM so Excel opens UTF-8
// files (e.g. names with accents) without mangling them.

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// rows: array of arrays. First row is treated as the header only by
// convention of what the caller passes in — this function itself just
// serializes whatever rows it's given.
function toCsv(rows) {
  const body = rows.map(row => row.map(escapeCsvValue).join(",")).join("\r\n");
  return "\uFEFF" + body; // BOM prefix
}

module.exports = { toCsv, escapeCsvValue };
