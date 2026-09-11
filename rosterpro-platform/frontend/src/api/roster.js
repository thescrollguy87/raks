import { api } from "./client.js";

export function getShiftDefinitions(stationId) {
  return api.get("/api/roster/shift-definitions", { stationId });
}

export function getRosterGrid(stationId, monthKey) {
  return api.get("/api/roster", { stationId, monthKey });
}

export function upsertShift(stationId, monthKey, { userId, shiftDate, shiftCode, note, reason, in1, out1, in2, out2 }) {
  return api.patch("/api/roster/shift", { userId, shiftDate, shiftCode, note, reason, in1, out1, in2, out2 }, { stationId, monthKey });
}

export function bulkUpsertShifts(stationId, monthKey, assignments) {
  return api.post(`/api/roster/shift/bulk?stationId=${stationId}&monthKey=${monthKey}`, { assignments });
}

export function listArchive(stationId) {
  return api.get("/api/roster/archive", { stationId });
}

// ─── Roster versioning (Roster History panel) ────────────────────────────────
export function listVersions(stationId, monthKey) {
  return api.get("/api/roster/versions", { stationId, monthKey });
}

export function getVersion(versionId) {
  return api.get(`/api/roster/versions/${versionId}`);
}

export function compareVersions(fromVersionId, toVersionId) {
  return api.get("/api/roster/versions/compare", { fromVersionId, toVersionId });
}

export function createVersion(stationId, monthKey, reason) {
  return api.post("/api/roster/versions", { stationId, monthKey, reason });
}

export function restoreVersion(versionId) {
  return api.post(`/api/roster/versions/${versionId}/restore`, {});
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

export async function downloadShiftDefinitionsTemplate() {
  return downloadFile("/api/roster/shift-definitions/template");
}

export async function downloadShiftDefinitionsExport(stationId) {
  return downloadFile("/api/roster/shift-definitions/export", { stationId });
}

export function importShiftDefinitions(file, stationId) {
  return api.upload("/api/roster/shift-definitions/import", { stationId }, file);
}

async function downloadFile(path, query) {
  const { blob, filename } = await api.download(path, query);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
