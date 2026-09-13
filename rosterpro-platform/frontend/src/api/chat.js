import { api } from "./client.js";

// stationId is always the CURRENTLY SELECTED station (see useStation()) —
// never left for the assistant to infer, so a cross-station question is
// something the backend can recognize and decline rather than silently
// answering for the wrong station.
export function askAssistant(stationId, question) {
  return api.post("/api/chat/ask", { stationId, question });
}

export function listConversationLog(params) {
  return api.get("/api/chat/log", params);
}
