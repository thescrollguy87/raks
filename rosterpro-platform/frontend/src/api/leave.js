import { api } from "./client.js";

export function listLeave(params) {
  return api.get("/api/leave", params);
}

export function getLeaveBalance(userId, year) {
  return api.get(`/api/leave/balance/${userId || ""}`, { year });
}

export function requestLeave(body) {
  return api.post("/api/leave", body);
}

export function decideLeave(id, decision, reason) {
  return api.post(`/api/leave/${id}/decide`, { decision, reason });
}

export function cancelLeave(id) {
  return api.post(`/api/leave/${id}/cancel`);
}
