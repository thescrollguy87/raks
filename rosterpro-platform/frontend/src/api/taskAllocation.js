// TASK ALLOCATION MODULE — its own API file, calling only
// /api/task-allocation/* (never touches /api/roster or any other existing
// endpoint). See backend/src/routes/taskAllocationRoutes.js.
import { api } from "./client.js";

const BASE = "/api/task-allocation";

// Public — no auth required, used to decide whether to show the nav
// section at all.
export function getEnabled() { return api.get(`${BASE}/enabled`); }

// ─── Section 6: roster sync / availability ───────────────────────────────────
export function getRosterSyncStatus(stationId, date) { return api.get(`${BASE}/roster-sync-status`, { stationId, date }); }
export function getAvailability(stationId, date) { return api.get(`${BASE}/availability`, { stationId, date }); }

// ─── Flight Instances ─────────────────────────────────────────────────────────
export function listFlightInstances(stationId, dateFrom, dateTo) { return api.get(`${BASE}/flight-instances`, { stationId, dateFrom, dateTo }); }
export function upsertFlightInstance(body) { return api.put(`${BASE}/flight-instances`, body); }
export function deleteFlightInstance(id) { return api.delete(`${BASE}/flight-instances/${id}`); }
export function replaceFlightInstancesForDay(stationId, flightDate, rows) {
  return api.post(`${BASE}/flight-instances/replace-day`, { stationId, flightDate, rows });
}

// ─── Allocation Rules / Settings / Travel Time ───────────────────────────────
export function listRules(stationId) { return api.get(`${BASE}/rules`, { stationId }); }
export function upsertRule(body) { return api.put(`${BASE}/rules`, body); }
export function deleteRule(id) { return api.delete(`${BASE}/rules/${id}`); }

export function getSettings(stationId) { return api.get(`${BASE}/settings`, { stationId }); }
export function updateSettings(stationId, body) { return api.patch(`${BASE}/settings`, body, { stationId }); }

export function listTravelTimes(stationId) { return api.get(`${BASE}/travel-time`, { stationId }); }
export function upsertTravelTime(body) { return api.put(`${BASE}/travel-time`, body); }
export function deleteTravelTime(id) { return api.delete(`${BASE}/travel-time/${id}`); }

// ─── Task Generator ───────────────────────────────────────────────────────────
export function generateTasks(stationId, date) { return api.post(`${BASE}/generate`, { stationId, date }); }

// ─── Tasks / Task Board ───────────────────────────────────────────────────────
export function listTasks(stationId, filters = {}) { return api.get(`${BASE}/tasks`, { stationId, ...filters }); }
export function getTask(stationId, id) { return api.get(`${BASE}/tasks/${id}`, { stationId }); }
export function createTask(body) { return api.post(`${BASE}/tasks`, body); }
export function cancelTask(stationId, id, reason) { return api.post(`${BASE}/tasks/${id}/cancel`, { stationId, reason }); }

// ─── Unassigned Tasks ─────────────────────────────────────────────────────────
export function listUnassigned(stationId, dateFrom, dateTo) { return api.get(`${BASE}/unassigned`, { stationId, dateFrom, dateTo }); }
export function explainUnassigned(stationId, id) { return api.get(`${BASE}/unassigned/${id}/explain`, { stationId }); }

// ─── Candidates / Eligibility ─────────────────────────────────────────────────
export function getCandidates(stationId, taskId) { return api.get(`${BASE}/candidates/${taskId}`, { stationId }); }

// ─── Allocation / Manual / Reallocation / What-If ────────────────────────────
export function runAutoAllocation(stationId, dateFrom, dateTo, taskSource) {
  return api.post(`${BASE}/allocate`, { stationId, dateFrom, dateTo, taskSource });
}
export function manualAssign(stationId, taskId, userId, opts = {}) {
  return api.post(`${BASE}/manual-assignment`, { stationId, taskId, userId, ...opts });
}
export function reallocateTask(stationId, taskId, trigger, triggerDetail) {
  return api.post(`${BASE}/reallocate`, { stationId, taskId, trigger, triggerDetail });
}
export function runWhatIf(stationId, userId, date, reason) {
  return api.post(`${BASE}/what-if`, { stationId, userId, date, reason });
}
export function commitWhatIf(stationId, runId) {
  return api.post(`${BASE}/what-if/commit`, { stationId, runId });
}

// ─── Conflicts ────────────────────────────────────────────────────────────────
export function listConflicts(stationId, filters = {}) { return api.get(`${BASE}/conflicts`, { stationId, ...filters }); }
export function detectConflicts(stationId, dateFrom, dateTo) { return api.post(`${BASE}/conflicts/detect`, { stationId, dateFrom, dateTo }); }

// ─── Allocation History ───────────────────────────────────────────────────────
export function listHistory(stationId, filters = {}) { return api.get(`${BASE}/history`, { stationId, ...filters }); }
export function listRuns(stationId) { return api.get(`${BASE}/runs`, { stationId }); }
export function getRun(stationId, id) { return api.get(`${BASE}/runs/${id}`, { stationId }); }
