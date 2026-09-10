// The Monthly Roster Excel format this app imports/exports/templates —
// matching the real "AMD M&E <MONTH> ROSTER" file the airline already
// works with day to day, not a format invented for this app:
//
//   Row 1: title (col A) + one Date per day of the month, starting col E
//   Row 2: weekday abbreviation under each date
//   Row 3: blank
//   Row 4: column labels — S/N, Staff Name, Designation, Staff ID
//   Row 5+: one row per staff member (S/N, Staff Name, Designation, Staff
//           ID, then one shift code per day) — blank rows between staff
//           are just visual spacers, skipped on import
//   Then, after a blank row: a "Legends" section (Legends/Description/
//           Timings header + one row per shift code) — informational only,
//           never parsed for staff/shift data.
//
// Staff Name conventionally carries the person's category in parentheses
// ("RAKESH PATEL (B1)") — cosmetic only; this app's own category comes
// from the matched User record, not parsed from the name. The importer
// strips a trailing "(...)" before falling back to a name match (Staff ID
// is the primary match key), the same way the roster/staff-detail UI
// already strips it for display (see `s.fullName.split("(")[0].trim()` in
// RosterPage.jsx and friends).

const LEADING_COLUMNS = 4; // S/N, Staff Name, Designation, Staff ID
const LEGEND_SENTINEL = "legends";

function stripNameSuffix(name) {
  return String(name || "").split("(")[0].trim();
}

// Row index (0-based into a sheetToRows()-style array of arrays) of the
// row holding the column labels — found by content, not a hardcoded row
// number, since a file might have an extra note row or a missing blank
// spacer above it.
function findHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const c0 = String(row[0] || "").trim().toUpperCase();
    const c1 = String(row[1] || "").trim().toUpperCase();
    if (c0 === "S/N" && c1.includes("STAFF NAME")) return i;
  }
  return -1;
}

// Row index of the date row — the nearest row ABOVE the header that has
// real Date values from the first day column onward.
function findDateRowIndex(rows, headerRowIndex) {
  for (let i = headerRowIndex - 1; i >= 0; i--) {
    if (rows[i].slice(LEADING_COLUMNS).some(v => v instanceof Date)) return i;
  }
  return -1;
}

module.exports = { LEADING_COLUMNS, LEGEND_SENTINEL, stripNameSuffix, findHeaderRowIndex, findDateRowIndex };
