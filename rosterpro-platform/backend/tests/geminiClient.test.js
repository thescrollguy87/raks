process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "gemini-3.6-flash";

const { generateContent } = require("../src/integrations/geminiClient");

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
  };
}

function textPart(text) {
  return { candidates: [{ content: { role: "model", parts: [{ text }] } }] };
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// Runs generateContent() and lets any pending fake-timer-driven retry
// delays resolve, without needing to know exactly how many there are.
async function runWithTimers(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 10 && !settled; i++) {
    await Promise.resolve(); // let microtasks (the in-flight fetch/json promises) flush
    await jest.advanceTimersByTimeAsync(60000);
  }
  return promise;
}

describe("geminiClient.generateContent — success paths", () => {
  it("returns the parsed candidate on a clean first try, with no retry", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(200, textPart("Hello")));
    const result = await runWithTimers(generateContent({ systemInstruction: "sys", contents: [] }));
    expect(result.text).toBe("Hello");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("extracts a functionCall part when the model wants a tool run", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(200, {
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "getShiftRoster", args: { date: "2026-11-01" } } }] } }],
    }));
    const result = await runWithTimers(generateContent({ systemInstruction: "sys", contents: [] }));
    expect(result.functionCall).toEqual({ name: "getShiftRoster", args: { date: "2026-11-01" } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("geminiClient.generateContent — retries transient failures", () => {
  it("retries a 429 and succeeds on the second attempt", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "Rate limited" } }))
      .mockResolvedValueOnce(jsonResponse(200, textPart("Recovered")));
    const result = await runWithTimers(generateContent({ systemInstruction: "sys", contents: [] }));
    expect(result.text).toBe("Recovered");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a 503 and succeeds on the third (final) attempt", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: "Overloaded" } }))
      .mockResolvedValueOnce(jsonResponse(503, { error: { message: "Overloaded" } }))
      .mockResolvedValueOnce(jsonResponse(200, textPart("Third time lucky")));
    const result = await runWithTimers(generateContent({ systemInstruction: "sys", contents: [] }));
    expect(result.text).toBe("Third time lucky");
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("retries a plain network failure (fetch rejects) and succeeds", async () => {
    global.fetch
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse(200, textPart("Back online")));
    const result = await runWithTimers(generateContent({ systemInstruction: "sys", contents: [] }));
    expect(result.text).toBe("Back online");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting all attempts and throws a 502 ApiError", async () => {
    global.fetch.mockResolvedValue(jsonResponse(503, { error: { message: "Still overloaded" } }));
    await expect(runWithTimers(generateContent({ systemInstruction: "sys", contents: [] })))
      .rejects.toMatchObject({ statusCode: 502, message: "Still overloaded" });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("respects a Retry-After header on a 429 instead of the default backoff", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "Rate limited" } }, { "retry-after": "5" }))
      .mockResolvedValueOnce(jsonResponse(200, textPart("ok")));
    const promise = generateContent({ systemInstruction: "sys", contents: [] });
    await Promise.resolve();
    // Advancing by less than the 5s Retry-After must NOT have triggered the retry yet.
    await jest.advanceTimersByTimeAsync(2000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(4000);
    const result = await promise;
    expect(result.text).toBe("ok");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("geminiClient.generateContent — never retries a permanent client error", () => {
  it("fails immediately on a 400 (malformed request), no retry", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(400, { error: { message: "Bad request shape" } }));
    await expect(runWithTimers(generateContent({ systemInstruction: "sys", contents: [] })))
      .rejects.toMatchObject({ statusCode: 502, message: "Bad request shape" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails immediately on a 401 (bad API key), no retry", async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(401, { error: { message: "Invalid API key" } }));
    await expect(runWithTimers(generateContent({ systemInstruction: "sys", contents: [] })))
      .rejects.toMatchObject({ statusCode: 502, message: "Invalid API key" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("geminiClient.generateContent — request timeout", () => {
  it("aborts a hung request and retries, rather than waiting forever", async () => {
    let callCount = 0;
    global.fetch.mockImplementation((url, { signal }) => {
      callCount++;
      if (callCount === 1) {
        // Simulate a genuinely hung request: resolves only if/when aborted.
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      return Promise.resolve(jsonResponse(200, textPart("finally")));
    });
    const result = await runWithTimers(generateContent({ systemInstruction: "sys", contents: [] }));
    expect(result.text).toBe("finally");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("geminiClient.generateContent — missing API key", () => {
  it("throws a clear 503 before ever calling fetch", async () => {
    const realKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    jest.resetModules();
    const { generateContent: generateContentNoKey } = require("../src/integrations/geminiClient");
    await expect(generateContentNoKey({ systemInstruction: "sys", contents: [] }))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(global.fetch).not.toHaveBeenCalled();
    process.env.GEMINI_API_KEY = realKey;
  });
});
