import { api } from "./client.js";

export function listStaff(params) {
  return api.get("/api/users", params);
}

export function createStaff(body) {
  return api.post("/api/users", body);
}

export function updateStaff(id, body) {
  return api.patch(`/api/users/${id}`, body);
}

export function deactivateStaff(id) {
  return api.post(`/api/users/${id}/deactivate`);
}

export function reactivateStaff(id) {
  return api.post(`/api/users/${id}/reactivate`);
}

export function assignRoles(id, roles) {
  return api.post(`/api/users/${id}/roles`, { roles });
}

export function deleteStaff(id) {
  return api.delete(`/api/users/${id}`);
}
