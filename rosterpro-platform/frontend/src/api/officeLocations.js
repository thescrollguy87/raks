import { api } from "./client.js";

export function listOfficeLocations(params) {
  return api.get("/api/office-locations", params);
}

export function createOfficeLocation(body) {
  return api.post("/api/office-locations", body);
}

export function updateOfficeLocation(id, body) {
  return api.put(`/api/office-locations/${id}`, body);
}

export function deleteOfficeLocation(id) {
  return api.delete(`/api/office-locations/${id}`);
}
