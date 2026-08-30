import { api } from "./client.js";

export function getFlightSchedule(stationId, year, month) {
  return api.get("/api/flight-schedule", { stationId, year, month });
}
export function importFlightSchedule(stationId, year, month, file) {
  return api.upload("/api/flight-schedule/import", { stationId, year, month }, file);
}
