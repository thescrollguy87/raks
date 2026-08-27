import { api } from "./client.js";

export function listFlights(stationId, from, to) {
  return api.get(`/api/flights/station/${stationId}`, { from, to });
}
export function listDelays(stationId, from, to) {
  return api.get(`/api/flights/station/${stationId}/delays`, { from, to });
}
export function recordDelay(body) {
  return api.post("/api/flights/delays", body);
}

export async function downloadFlightScheduleTemplate() {
  const { blob, filename } = await api.download("/api/flights/import/template");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importFlightSchedule(stationId, monthKey, file) {
  return api.upload("/api/flights/import", { stationId, monthKey }, file);
}
