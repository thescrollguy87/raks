import { api } from "./client.js";

export function getComplianceSummary(userId) {
  return api.get(`/api/compliance/summary/${userId}`);
}

export function createQualification(body) {
  return api.post("/api/compliance/qualifications", body);
}
export function deleteQualification(id, reason) {
  return api.delete(`/api/compliance/qualifications/${id}`, { reason });
}

export function createLicense(body) {
  return api.post("/api/compliance/licenses", body);
}

export function createTraining(body) {
  return api.post("/api/compliance/trainings", body);
}

export function createAuthorization(body) {
  return api.post("/api/compliance/authorizations", body);
}
