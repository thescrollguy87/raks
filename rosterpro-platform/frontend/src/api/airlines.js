import { api } from "./client.js";

// SUPER_ADMIN-only — see backend/src/routes/airlineRoutes.js.
export function listAirlines() {
  return api.get("/api/airlines");
}

export function createAirline(body) {
  return api.post("/api/airlines", body);
}
