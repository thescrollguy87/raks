import { api } from "./client.js";

export function listStations() {
  return api.get("/api/stations");
}

// SUPER_ADMIN/AIRLINE_ADMIN only — see backend/src/routes/stationRoutes.js.
export function createStation(body) {
  return api.post("/api/stations", body);
}
