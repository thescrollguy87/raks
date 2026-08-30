import { api } from "./client.js";

export function listAdjustments(stationId, monthKey) {
  return api.get("/api/daily-ops", { stationId, monthKey });
}
export function createAdjustment(entry) {
  return api.post("/api/daily-ops", entry);
}
export function deleteAdjustment(id) {
  return api.delete(`/api/daily-ops/${id}`);
}
export function getComparison(stationId, monthKey) {
  return api.get("/api/daily-ops/comparison", { stationId, monthKey });
}
