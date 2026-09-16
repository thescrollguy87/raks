import { api } from "./client.js";

export function getToday() {
  return api.get("/api/attendance/today");
}

export function punchIn(body) {
  return api.post("/api/attendance/punch-in", body);
}

export function punchOut(body) {
  return api.post("/api/attendance/punch-out", body);
}

export function listAttendance(params) {
  return api.get("/api/attendance", params);
}

export function getOverview(params) {
  return api.get("/api/attendance/overview", params);
}
