import { api } from "./client.js";

export function getShiftDefinitions() {
  return api.get("/api/roster/shift-definitions");
}

export function getRosterGrid(stationId, monthKey) {
  return api.get("/api/roster", { stationId, monthKey });
}

export function upsertShift(stationId, monthKey, { userId, shiftDate, shiftCode, note, reason }) {
  return api.patch("/api/roster/shift", { userId, shiftDate, shiftCode, note, reason }, { stationId, monthKey });
}

export function bulkUpsertShifts(stationId, monthKey, assignments) {
  return api.post(`/api/roster/shift/bulk?stationId=${stationId}&monthKey=${monthKey}`, { assignments });
}

export function listArchive(stationId) {
  return api.get("/api/roster/archive", { stationId });
}

export function importRoster(stationId, monthKey, file) {
  return api.upload("/api/roster/import", { stationId, monthKey }, file);
}

export function generateRoster(stationId, monthKey, options = {}) {
  return api.post("/api/roster/generate", { stationId, monthKey, ...options });
}

export function publishRoster(rosterId) {
  return api.post("/api/roster/publish", { rosterId });
}

export function unpublishRoster(rosterId, reason) {
  return api.post("/api/roster/unpublish", { rosterId, reason });
}
