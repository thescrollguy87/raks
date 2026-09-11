import { api } from "./client.js";

export function getDashboardSummary(stationId, params) {
  return api.get(`/api/dashboard/${stationId}/summary`, params);
}

// Airline-wide roles see every station they can access; a station-scoped
// caller gets back just their own one row (the backend filters, not this
// call) — same shape either way, so the page never needs to branch on role.
export function getStationsOverview() {
  return api.get("/api/dashboard/stations-overview");
}
