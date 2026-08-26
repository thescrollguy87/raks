import { api } from "./client.js";

export function getDashboardSummary(stationId, params) {
  return api.get(`/api/dashboard/${stationId}/summary`, params);
}
