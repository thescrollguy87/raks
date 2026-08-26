import { api } from "./client.js";

export function listStoreItems(stationId) {
  return api.get(`/api/stores/station/${stationId}`);
}
export function listLowStock(stationId) {
  return api.get(`/api/stores/station/${stationId}/low-stock`);
}
export function createStoreItem(body) {
  return api.post("/api/stores", body);
}
export function recordMovement(itemId, body) {
  return api.post(`/api/stores/${itemId}/movement`, body);
}
export function listMovements(itemId) {
  return api.get(`/api/stores/${itemId}/movements`);
}
