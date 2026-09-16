import { api } from "./client.js";

export function listRegularizations(params) {
  return api.get("/api/regularization", params);
}

export function createRegularization(body) {
  return api.post("/api/regularization", body);
}

export function decideRegularization(id, decision, reason) {
  return api.post(`/api/regularization/${id}/decide`, { decision, reason });
}

export function cancelRegularization(id) {
  return api.post(`/api/regularization/${id}/cancel`);
}
