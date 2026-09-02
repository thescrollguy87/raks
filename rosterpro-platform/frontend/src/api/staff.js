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

export function deleteStaff(id, confirm) {
  return api.delete(`/api/users/${id}`, confirm ? { confirm: "true" } : undefined);
}

export async function downloadEmployeeMasterTemplate() {
  const { blob, filename } = await api.download("/api/users/import/template");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importEmployeeMaster(stationId, file) {
  return api.upload("/api/users/import", { stationId }, file);
}

export async function exportEmployeeMaster(stationId) {
  const { blob, filename } = await api.download("/api/users/export", { stationId });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
