import { api } from "./client.js";

export function getConfig(stationId) {
  return api.get("/api/workload-config", { stationId });
}
export function upsertConfig(config) {
  return api.put("/api/workload-config", config);
}

export function listMandatoryCoverageRules(stationId) {
  return api.get("/api/workload-config/mandatory-coverage", { stationId });
}
export function upsertMandatoryCoverageRule(rule) {
  return api.put("/api/workload-config/mandatory-coverage", rule);
}

export function listPlannedTasks(stationId) {
  return api.get("/api/workload-config/planned-tasks", { stationId });
}
export function upsertPlannedTask(task) {
  return api.put("/api/workload-config/planned-tasks", task);
}
export function deletePlannedTask(id) {
  return api.delete(`/api/workload-config/planned-tasks/${id}`);
}

export function listUnplannedTasks(stationId) {
  return api.get("/api/workload-config/unplanned-tasks", { stationId });
}
export function upsertUnplannedTask(task) {
  return api.put("/api/workload-config/unplanned-tasks", task);
}
export function deleteUnplannedTask(id) {
  return api.delete(`/api/workload-config/unplanned-tasks/${id}`);
}

export function getFlightDerivedSummary(stationId, year, month) {
  return api.get("/api/workload-config/flight-derived-summary", { stationId, year, month });
}

export function listManualDemand(stationId, monthKey) {
  return api.get("/api/workload-config/manual-demand", { stationId, monthKey });
}
export function createManualDemand(entry) {
  return api.post("/api/workload-config/manual-demand", entry);
}
export function deleteManualDemand(id) {
  return api.delete(`/api/workload-config/manual-demand/${id}`);
}
