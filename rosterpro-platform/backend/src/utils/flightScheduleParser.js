// Ported verbatim from the RosterPro PWA (RosterProPWA9.zip)'s Flight
// Schedule Import (Turn Report) section — built and verified against a
// REAL uploaded Turn Report file, not a description of one. Several of the
// handling rules below exist specifically because the real file didn't
// match what a plain reading of "16 columns, dates, times, days of week"
// would suggest. Do not "clean up" or simplify these without re-verifying
// against a real export — every quirk here was found the hard way.

// "Days of the Week" is a 7-character self-referential code: the character
// at position N (1-7, Monday=1) is either the digit N itself (operates that
// day) or a dot (doesn't). Critically, Excel's automatic type detection
// silently mangles this into a NUMBER whenever the resulting text happens
// to be syntactically valid as one — a leading dot becomes "0.234567", a
// dot in the middle becomes "123.567", no dots at all becomes the plain
// integer 1234567. Only patterns Excel can't parse as a number (multiple
// dots, or a dot with nothing after it) survive as literal text. This
// reconstructs the original 7-character pattern regardless of which of the
// four raw types (string/int/float/blank) Excel actually stored.
function decodeDaysOfWeek(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  let s;
  if (typeof raw === "number") {
    s = String(raw);
    if (s.startsWith("0.")) s = s.slice(1); // Excel's inserted leading zero for a bare leading-dot pattern
  } else {
    s = String(raw).trim();
  }
  if (!s) return null;
  while (s.length < 7) s += "."; // trailing off-days Excel's numeric parsing may have dropped (e.g. a trailing '.')
  s = s.slice(0, 7);
  const days = []; // [mon,tue,wed,thu,fri,sat,sun]
  for (let i = 0; i < 7; i++) days.push(s[i] === String(i + 1));
  return { pattern: s, days };
}

// Accepts whatever shape a time-of-day cell comes back as from the Excel
// reader — a JS Date, a raw Excel serial fraction (<1 for a pure time), or
// an already-formatted "HH:MM"/"HH:MM:SS" string — and always returns
// minutes-since-midnight. Used for both real clock times (departure/
// arrival) AND "Ground Time", which is a DURATION formatted as a
// time-of-day cell (4:30 in the Ground Time column means 4h30m, not
// 4:30am) — the minute-extraction math is identical either way, only the
// caller's interpretation of what the number MEANS differs.
function excelCellToMinutes(val) {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date) return val.getUTCHours() * 60 + val.getUTCMinutes();
  if (typeof val === "number") {
    if (val < 1) return Math.round(val * 24 * 60); // pure time fraction
    const frac = val - Math.floor(val); // date+time serial — take just the time part
    return Math.round(frac * 24 * 60);
  }
  const m = String(val).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return (+m[1]) * 60 + (+m[2]);
  return null;
}

// Same defensive multi-format handling for a DATE-only cell (Effective
// Date, Discontinue Date). Excel's epoch is Dec 30 1899 for serial 0 —
// this offset already accounts for Excel's well-known (but irrelevant for
// any 2026 date) leap-year bug.
function excelCellToDate(val) {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date) return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  if (typeof val === "number") {
    const ms = Math.round((val - 25569) * 86400 * 1000); // 25569 = days between 1899-12-30 and 1970-01-01
    const d = new Date(ms);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); // DD-MM-YYYY or DD/MM/YYYY
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const parsed = new Date(s);
  return isNaN(parsed) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function minutesToHHMM(min) {
  if (min === null || min === undefined) return "";
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// Finds the header row by CONTENT (searching for a known column name)
// rather than assuming a fixed row number — the real Turn Report has a
// title banner on row 1 and headers on row 2, but relying on that exact
// position would break the moment a different month's export shifts by a
// row, which title-banner-style reports are prone to doing.
function findHeaderRow(rows, mustContain) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r] || [];
    if (row.some(c => String(c || "").trim() === mustContain)) return r;
  }
  return -1;
}

// Parses the main "Inbound/Outbound" turn sheet. Skips entirely-blank rows
// — the real file had far more blank filler rows mixed in than actual data
// rows, which a naive "loop every row" parser would have choked on or
// silently miscounted.
function parseTurnReportRows(rows) {
  const headerRow = findHeaderRow(rows, "Inbound Aln");
  if (headerRow === -1) return { records: [], error: "Could not find the Turn Report header row (looking for 'Inbound Aln') — is this the right sheet/file?" };
  const records = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0]) continue; // blank filler row
    const daysInfo = decodeDaysOfWeek(row[14]);
    records.push({
      aln: row[0], inboundFlt: row[1], inboundDepSta: row[2], inboundDepMin: excelCellToMinutes(row[3]),
      inboundArrSta: row[4], inboundArrMin: excelCellToMinutes(row[5]),
      groundTimeMin: excelCellToMinutes(row[6]),
      outboundDepSta: row[7], outboundFlt: row[8], outboundDepMin: excelCellToMinutes(row[9]),
      outboundArrSta: row[10], outboundArrMin: excelCellToMinutes(row[11]),
      effectiveDate: excelCellToDate(row[12]), discontinueDate: excelCellToDate(row[13]),
      daysOfWeek: daysInfo, remark: row[15] || "",
    });
  }
  return { records, error: null };
}

// Parses the separate "Charter Flights" sheet — a genuinely different
// layout (single-leg, not inbound/outbound turn pairs; header found by
// content search rather than assumed position).
function parseCharterRows(rows) {
  const headerRow = findHeaderRow(rows, "Flt Desg");
  if (headerRow === -1) return { records: [], error: null }; // charter sheet is optional — absence isn't an error
  const records = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[1]) continue;
    records.push({
      flightDesg: row[1], effectiveDate: excelCellToDate(row[2]), discontinueDate: excelCellToDate(row[3]),
      daysOfWeek: decodeDaysOfWeek(row[4]), depSta: row[5], depMin: excelCellToMinutes(row[6]),
      arrSta: row[7], arrMin: excelCellToMinutes(row[8]), serviceType: row[9] || "",
    });
  }
  return { records, error: null };
}

// Expands Effective/Discontinue/Days-of-Week into the actual calendar
// dates a record operates within a given target month.
function expandOperatingDates(effDate, discDate, daysOfWeek, year, month) {
  if (!effDate || !discDate || !daysOfWeek) return [];
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const start = effDate > monthStart ? effDate : monthStart;
  const end = discDate < monthEnd ? discDate : monthEnd;
  if (start > end) return [];
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const isoDow = d.getDay() === 0 ? 7 : d.getDay(); // JS: Sun=0..Sat=6 -> ISO: Mon=1..Sun=7
    if (daysOfWeek.days[isoDow - 1]) dates.push(new Date(d));
  }
  return dates;
}

// Aggregates operating-day and movement statistics — "movement" = one
// takeoff or landing; a single turn-report row occurring on one operating
// date contributes 2 movements (inbound arrival + outbound departure) if
// both legs are present, matching standard aviation usage of the term.
function computeFlightWorkloadSummary(turnRecords, charterRecords, year, month) {
  const byDate = {}; // "YYYY-MM-DD" -> movement count
  const operatingDateSet = new Set();

  turnRecords.forEach(rec => {
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(d => {
      const key = d.toISOString().slice(0, 10);
      operatingDateSet.add(key);
      let movements = 0;
      if (rec.inboundFlt) movements++;
      if (rec.outboundFlt) movements++;
      byDate[key] = (byDate[key] || 0) + movements;
    });
  });
  charterRecords.forEach(rec => {
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(d => {
      const key = d.toISOString().slice(0, 10);
      operatingDateSet.add(key);
      byDate[key] = (byDate[key] || 0) + 1; // one leg = one movement
    });
  });

  const dailyCounts = Object.values(byDate);
  const totalMovements = dailyCounts.reduce((a, b) => a + b, 0);
  const daysInMonth = new Date(year, month, 0).getDate();
  let peakDate = null, peakCount = 0;
  Object.entries(byDate).forEach(([k, v]) => { if (v > peakCount) { peakCount = v; peakDate = k; } });

  return {
    operatingDays: operatingDateSet.size,
    daysInMonth,
    totalMovements,
    avgDailyMovements: operatingDateSet.size ? Math.round((totalMovements / operatingDateSet.size) * 10) / 10 : 0,
    peakDailyMovements: peakCount,
    peakDate,
    byDate,
    turnRowCount: turnRecords.length,
    charterRowCount: charterRecords.length,
  };
}

// Item 2: expands the imported flight schedule into an actual day-by-day
// list — every day 1..daysInMonth listed, including days with zero flights.
function buildDailyFlightSchedule(turnRecords, charterRecords, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const byDay = {};
  for (let d = 1; d <= daysInMonth; d++) byDay[d] = [];

  turnRecords.forEach(rec => {
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(date => {
      byDay[date.getDate()].push({
        type: "Turn", flightRef: `${rec.inboundFlt || "-"} / ${rec.outboundFlt || "-"}`,
        route: `${rec.inboundDepSta || "-"}→${rec.inboundArrSta || "-"}→${rec.outboundArrSta || "-"}`,
        arr: minutesToHHMM(rec.inboundArrMin), dep: minutesToHHMM(rec.outboundDepMin),
        ground: rec.groundTimeMin !== null ? rec.groundTimeMin + "m" : "-",
      });
    });
  });
  charterRecords.forEach(rec => {
    const dates = expandOperatingDates(rec.effectiveDate, rec.discontinueDate, rec.daysOfWeek, year, month);
    dates.forEach(date => {
      byDay[date.getDate()].push({
        type: "Charter", flightRef: rec.flightDesg || "-",
        route: `${rec.depSta || "-"}→${rec.arrSta || "-"}`,
        arr: "-", dep: minutesToHHMM(rec.depMin), ground: "-",
      });
    });
  });
  Object.values(byDay).forEach(list => list.sort((a, b) => (a.dep || a.arr || "").localeCompare(b.dep || b.arr || "")));
  return { byDay, daysInMonth };
}

module.exports = {
  decodeDaysOfWeek, excelCellToMinutes, excelCellToDate, minutesToHHMM,
  findHeaderRow, parseTurnReportRows, parseCharterRows, expandOperatingDates,
  computeFlightWorkloadSummary, buildDailyFlightSchedule,
};
