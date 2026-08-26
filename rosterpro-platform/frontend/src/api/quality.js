import { api } from "./client.js";

export function listFindings(stationId, status) {
  return api.get(`/api/quality/findings/station/${stationId}`, { status });
}
export function raiseFinding(body) {
  return api.post("/api/quality/findings", body);
}
export function updateFinding(id, body) {
  return api.patch(`/api/quality/findings/${id}`, body);
}
export function listCapasForOwner(ownerId, status) {
  return api.get(`/api/quality/capas/owner/${ownerId}`, { status });
}
export function openCapa(body) {
  return api.post("/api/quality/capas", body);
}
export function closeCapa(id, body) {
  return api.post(`/api/quality/capas/${id}/close`, body);
}
export function listOverdue() {
  return api.get("/api/quality/overdue");
}
