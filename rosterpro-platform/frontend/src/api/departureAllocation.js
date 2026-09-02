import { api } from "./client.js";

export function listEligibleStaff(stationId) {
  return api.get("/api/departure-allocation/staff", { stationId });
}

export function getDayAllocation(stationId, year, month, day) {
  return api.get("/api/departure-allocation", { stationId, year, month, day });
}

export function autoAllocateDay(stationId, year, month, day) {
  return api.post("/api/departure-allocation/auto-allocate", { stationId, year, month, day });
}

export function assignManual(input) {
  return api.post("/api/departure-allocation/assign", input);
}
