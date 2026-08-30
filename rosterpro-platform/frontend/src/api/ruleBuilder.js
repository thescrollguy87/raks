import { api } from "./client.js";

export function listStaffGroups(stationId) {
  return api.get("/api/rule-builder/staff-groups", { stationId });
}
export function upsertStaffGroup(group) {
  return api.put("/api/rule-builder/staff-groups", group);
}
export function deleteStaffGroup(id) {
  return api.delete(`/api/rule-builder/staff-groups/${id}`);
}

export function listRules(stationId) {
  return api.get("/api/rule-builder", { stationId });
}
export function upsertRule(rule) {
  return api.put("/api/rule-builder", rule);
}
export function deleteRule(id) {
  return api.delete(`/api/rule-builder/${id}`);
}
