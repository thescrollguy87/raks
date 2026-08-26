import { api } from "./client.js";

export function listStaff(params) {
  return api.get("/api/users", params);
}
