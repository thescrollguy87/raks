import { api } from "./client.js";

export function listTools(stationId) {
  return api.get(`/api/tools/station/${stationId}`);
}
export function dueForCalibration(days) {
  return api.get("/api/tools/due-for-calibration", { days });
}
export function createTool(body) {
  return api.post("/api/tools", body);
}
export function calibrateTool(id, body) {
  return api.post(`/api/tools/${id}/calibrate`, body);
}
export function issueTool(id, body) {
  return api.post(`/api/tools/${id}/issue`, body);
}
export function returnTool(issueId) {
  return api.post("/api/tools/return", { issueId });
}
