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

// Transient-failure handling: the free tier is exactly where a 429 (rate
// limit) or a momentary 503 shows up, and a plain network blip is always
// possible — previously ANY of these surfaced as an immediate, hard
// failure to the user ("Couldn't answer") with no second attempt.
// MAX_ATTEMPTS = 1 initial try + 2 retries. Retries only ever apply to
// genuinely transient conditions (429, 5xx, network error, timeout) — a
// 400/401/403/404 means the REQUEST itself is wrong (bad key, malformed
// body), and retrying that would just delay an inevitable identical
// failure, so those still fail immediately, exactly as before.
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 600;
// A hung request needs to fail on its own terms, soon enough for a retry
// to still be worth it, well under any upstream proxy's own timeout —
// otherwise a stall just surfaces as an opaque, unhelpful gateway error
// with no retry ever attempted.
const REQUEST_TIMEOUT_MS = 25000;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

// One raw HTTP attempt: the fetch itself, the timeout, and response
// parsing — no retry decision-making here. Throws a plain Error carrying
// `.retryable` (and `.status`/`.retryAfterMs` when it came from a real
// HTTP response) for the loop in generateContent to act on.
async function attemptOnce(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (networkErr) {
    const isTimeout = networkErr.name === "AbortError";
    const err = new Error(isTimeout ? `Gemini API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : `Gemini API request failed: ${networkErr.message}`);
    err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Gemini API returned HTTP ${res.status}`);
    err.status = res.status;
    err.retryable = isRetryableStatus(res.status);
    // Gemini (like most Google APIs) can send a Retry-After header on a
    // 429 — respect it when present instead of guessing with a fixed
    // backoff, so a real quota reset time is honored rather than ignored.
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    if (!Number.isNaN(retryAfterSec)) err.retryAfterMs = retryAfterSec * 1000;
    throw err;
  }

  return json;
}

// One turn of the function-calling loop: send the conversation so far
// (system instruction + contents) plus the tool schema, get back either a
// functionCall part (Gemini wants a tool run) or a text part (the final
// answer). Callers drive the loop — this function makes one logical
// request (internally retried on transient failure) and returns Gemini's
// raw candidate content, nothing more.
async function generateContent({ systemInstruction, contents, tools }) {
  assertConfigured();
  const url = `${BASE_URL}/${encodeURIComponent(env.gemini.model)}:generateContent?key=${env.gemini.apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    ...(tools ? { tools: [{ functionDeclarations: tools }] } : {}),
  };

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const json = await attemptOnce(url, body);
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
    } catch (err) {
      lastErr = err;
      const willRetry = err.retryable && attempt < MAX_ATTEMPTS;
      logger.error(`Gemini API attempt ${attempt}/${MAX_ATTEMPTS} failed${willRetry ? " — retrying" : ""}: ${err.message}`);
      if (!willRetry) break;
      const delay = err.retryAfterMs || BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  // A real HTTP error carries Gemini's own message (status set) — surface
  // it directly, same as before. A network failure/timeout never reached
  // a real response, so it keeps the generic, user-facing message.
  throw new ApiError(502, lastErr?.status ? lastErr.message : "Couldn't reach the Roster Assistant's language model right now.");
}

module.exports = { generateContent };
