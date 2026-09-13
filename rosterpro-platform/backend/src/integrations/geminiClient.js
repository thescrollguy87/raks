// Thin wrapper around Google's Gemini REST API (generativelanguage
// googleapis.com) — the free-tier Flash model, chosen specifically because
// it has a genuinely usable ongoing free tier for this kind of low-volume,
// per-question assistant use case (unlike Anthropic's API, which has no
// meaningful free tier for this). The API key is read from
// env.gemini.apiKey (GEMINI_API_KEY) — server-side only. Nothing in this
// file, or anything that calls it, ever sends this key to the frontend;
// the browser only ever talks to our own /api/chat/ask endpoint.
const env = require("../config/env");
const logger = require("../config/logger");
const ApiError = require("../utils/ApiError");

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Every thrown error here MUST be an ApiError, not a plain Error — the
// central error handler (middleware/errorHandler.js) only preserves a
// custom statusCode/message for ApiError instances; anything else gets
// flattened to a generic "Internal server error" before it ever reaches
// the frontend, silently swallowing these deliberately clear messages.
function assertConfigured() {
  if (!env.gemini.apiKey) {
    throw new ApiError(503, "The Roster Assistant isn't configured yet — GEMINI_API_KEY is not set.");
  }
}

// One turn of the function-calling loop: send the conversation so far
// (system instruction + contents) plus the tool schema, get back either a
// functionCall part (Gemini wants a tool run) or a text part (the final
// answer). Callers drive the loop — this function makes exactly one HTTP
// call and returns Gemini's raw candidate content, nothing more.
async function generateContent({ systemInstruction, contents, tools }) {
  assertConfigured();
  const url = `${BASE_URL}/${encodeURIComponent(env.gemini.model)}:generateContent?key=${env.gemini.apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    ...(tools ? { tools: [{ functionDeclarations: tools }] } : {}),
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    logger.error(`Gemini API request failed: ${networkErr.message}`);
    throw new ApiError(502, "Couldn't reach the Roster Assistant's language model right now.");
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    logger.error(`Gemini API error ${res.status}: ${JSON.stringify(json)?.slice(0, 500)}`);
    throw new ApiError(502, json?.error?.message || `Gemini API returned HTTP ${res.status}`);
  }

  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const functionCallPart = parts.find(p => p.functionCall);
  const textParts = parts.filter(p => typeof p.text === "string").map(p => p.text);

  return {
    role: candidate?.content?.role || "model",
    parts,
    functionCall: functionCallPart ? functionCallPart.functionCall : null,
    text: textParts.join("").trim(),
    finishReason: candidate?.finishReason || null,
  };
}

module.exports = { generateContent };
