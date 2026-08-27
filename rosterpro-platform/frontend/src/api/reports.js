import { api } from "./client.js";

export async function downloadReport(type, format, params) {
  const { blob, filename } = await api.download("/api/reports/download", { type, format, ...params });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function emailReport(type, format, params, toEmail) {
  return api.post("/api/reports/email", { type, format, ...params, toEmail });
}

export async function downloadBARoster(stationId, date) {
  const { blob, filename } = await api.download("/api/reports/ba-roster", { stationId, date });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
