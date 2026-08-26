import { api } from "./client.js";

export function listActivity(params) {
  return api.get("/api/audit/activity", params);
}
export function listAuditTrail(params) {
  return api.get("/api/audit/trail", params);
}
export function getEntityHistory(entityType, entityId) {
  return api.get(`/api/audit/trail/${entityType}/${entityId}`);
}
