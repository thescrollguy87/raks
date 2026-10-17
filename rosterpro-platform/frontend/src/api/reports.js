import { api } from "./client.js";

export async function downloadReport(type, format, params) {
  const { blob, filename } = await api.download("/api/reports/download", { type, format, ...params });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function emailReport(type, format, params, toEmail) {
  return api.post("/api/reports/email", { type, format, ...params, toEmail });
}

// toDate is optional — omit it (or pass the same value as fromDate) for the
// original single-day export; pass a later toDate to export a range in one file.
export async function downloadBARoster(stationId, fromDate, toDate) {
  const { blob, filename } = await api.download("/api/reports/ba-roster", { stationId, fromDate, toDate });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Checks for any shift code that has no PeopleStrong Shift_List equivalent
// (e.g. a custom pattern or a variant like M1/A2) BEFORE/alongside the real
// download — those cells come back blank in the file itself, so this is
// what lets the UI tell the user exactly which staff/days need a manual fix.
export function getPeopleStrongRosterWarnings(stationId, monthKey) {
  return api.get("/api/reports/people-strong-roster/warnings", { stationId, monthKey });
}

export async function downloadPeopleStrongRoster(stationId, monthKey) {
  const { blob, filename } = await api.download("/api/reports/people-strong-roster", { stationId, monthKey });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
