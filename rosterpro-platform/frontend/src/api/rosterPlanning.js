import { api } from "./client.js";

// ─── Shift Definitions (single-row CRUD, for the Auto-Roster wizard's own
// Shift Definitions tab — distinct from the bulk import/export in api/roster.js) ─
export function upsertShiftDefinition(def) {
  return api.put("/api/roster/shift-definitions", def);
}
export function deleteShiftDefinition(id) {
  return api.delete(`/api/roster/shift-definitions/${id}`);
}

// ─── Shift Patterns ───────────────────────────────────────────────────────────
export function listPatterns(stationId) {
  return api.get("/api/roster/patterns", { stationId });
}
export function upsertPattern(pattern) {
  return api.put("/api/roster/patterns", pattern);
}
export function deletePattern(id) {
  return api.delete(`/api/roster/patterns/${id}`);
}

// ─── Staff Allocation ─────────────────────────────────────────────────────────
export function listAllocations(stationId) {
  return api.get("/api/roster/allocations", { stationId });
}
export function upsertAllocation(allocation) {
  return api.put("/api/roster/allocations", allocation);
}

// ─── Workload Input ───────────────────────────────────────────────────────────
export function listWorkloadItems(stationId) {
  return api.get("/api/roster/workload-items", { stationId });
}
export function upsertWorkloadItem(item) {
  return api.put("/api/roster/workload-items", item);
}
export function deleteWorkloadItem(id) {
  return api.delete(`/api/roster/workload-items/${id}`);
}

// ─── Manpower Plan (Generate tab's "Calculate" step) ─────────────────────────
export function getManpowerPlan(stationId, monthKey, aogBuffer) {
  return api.get("/api/roster/manpower-plan", { stationId, monthKey, aogBuffer });
}
