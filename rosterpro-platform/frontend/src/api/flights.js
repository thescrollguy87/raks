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
