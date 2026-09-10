import { api } from "./client.js";

export function getComplianceSummary(userId) {
  return api.get(`/api/compliance/summary/${userId}`);
}

export function createQualification(body) {
  return api.post("/api/compliance/qualifications", body);
}
export function updateQualification(id, body) {
  return api.patch(`/api/compliance/qualifications/${id}`, body);
}
export function deleteQualification(id, reason) {
  return api.delete(`/api/compliance/qualifications/${id}`, { reason });
}

export function createLicense(body) {
  return api.post("/api/compliance/licenses", body);
}
export function updateLicense(id, body) {
  return api.patch(`/api/compliance/licenses/${id}`, body);
}
export function deleteLicense(id, reason) {
  return api.delete(`/api/compliance/licenses/${id}`, { reason });
}

export function createTraining(body) {
  return api.post("/api/compliance/trainings", body);
}
export function updateTraining(id, body) {
  return api.patch(`/api/compliance/trainings/${id}`, body);
}
export function deleteTraining(id, reason) {
  return api.delete(`/api/compliance/trainings/${id}`, { reason });
}

export function createAuthorization(body) {
  return api.post("/api/compliance/authorizations", body);
}
export function updateAuthorization(id, body) {
  return api.patch(`/api/compliance/authorizations/${id}`, body);
}
export function deleteAuthorization(id, reason) {
  return api.delete(`/api/compliance/authorizations/${id}`, { reason });
}
