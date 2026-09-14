import { api } from "./client.js";

export function listHolidays(params) {
  return api.get("/api/holidays", params);
}

export function createHoliday(body) {
  return api.post("/api/holidays", body);
}

export function updateHoliday(id, body) {
  return api.put(`/api/holidays/${id}`, body);
}

export function deleteHoliday(id) {
  return api.delete(`/api/holidays/${id}`);
}
