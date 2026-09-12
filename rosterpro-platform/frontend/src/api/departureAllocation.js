import { api } from "./client.js";

export function getDayAllocation(stationId, year, month, day) {
  return api.get("/api/departure-allocation", { stationId, year, month, day });
}

export function autoAllocateDay(stationId, year, month, day) {
  return api.post("/api/departure-allocation/auto-allocate", { stationId, year, month, day });
}

export function assignManual(input) {
  return api.post("/api/departure-allocation/assign", input);
}

export function getMonthManpowerSummary(stationId, year, month) {
  return api.get("/api/departure-allocation/month-summary", { stationId, year, month });
}
