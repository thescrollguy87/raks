// Integration-style tests of the full ask-Gemini/execute-tool/feed-back
// loop. Gemini's HTTP layer is mocked (no live API key in this
// environment) but everything downstream of it is real orchestration
// logic — this is what actually proves the CRITICAL architecture: a
// simulated model requesting a tool call really does reach the real tool
// function, with the real session's station injected, and the answer
// returned is traceable to real tool output, not invented.
jest.mock("../src/integrations/geminiClient");
jest.mock("../src/services/chatToolsService");
jest.mock("../src/repositories/stationRepository");
jest.mock("../src/utils/auditTrail");
jest.mock("../src/config/prisma", () => ({
  chatConversationLog: { create: jest.fn().mockResolvedValue({}), count: jest.fn(), findMany: jest.fn() },
}));

const geminiClient = require("../src/integrations/geminiClient");
const chatToolsService = require("../src/services/chatToolsService");
const stationRepo = require("../src/repositories/stationRepository");
const prisma = require("../src/config/prisma");
const chatAssistantService = require("../src/services/chatAssistantService");

const STATION_ID = "station-amd";
const OTHER_STATION_ID = "station-bom";
const actor = { sub: "u1", name: "Priya", stationId: STATION_ID, airlineId: "airline-1", roles: ["STATION_MANAGER"] };
const req = { ip: "10.0.0.1" };

beforeEach(() => {
  stationRepo.listStations.mockResolvedValue([
    { id: STATION_ID, name: "Ahmedabad", iataCode: "AMD", airlineName: "Akasa Air" },
    { id: OTHER_STATION_ID, name: "Mumbai", iataCode: "BOM", airlineName: "Akasa Air" },
  ]);
});

// Scenario 1 from the spec: "Do I have enough NCS for Tuesday night?"
it("chains two real tool calls (category requirement + shift roster) and returns a grounded answer", async () => {
  chatToolsService.getCategoryRequirement.mockResolvedValue({
    categories: [{ category: "NCS", required: 4, available: 2, status: "SHORT", shortfall: 2 }],
  });
  chatToolsService.getShiftRoster.mockResolvedValue({
    entries: [{ fullName: "Aditya Poonia", category: "NCS" }, { fullName: "Kevin Jerome", category: "NCS" }],
  });
  geminiClient.generateContent
    .mockResolvedValueOnce({ functionCall: { name: "getCategoryRequirement", args: { date: "2026-09-15", shift: "Night" } }, text: "" })
    .mockResolvedValueOnce({ functionCall: { name: "getShiftRoster", args: { date: "2026-09-15", category: "NCS" } }, text: "" })
    .mockResolvedValueOnce({ functionCall: null, text: "You need 4 NCS Tuesday night but only 2 are rostered (Aditya Poonia, Kevin Jerome) — you're short by 2." });

  const result = await chatAssistantService.askAssistant({ question: "Do I have enough NCS for Tuesday night?", stationId: STATION_ID }, actor, req);

  expect(chatToolsService.getCategoryRequirement).toHaveBeenCalledWith(
    { date: "2026-09-15", shift: "Night" },
    expect.objectContaining({ stationId: STATION_ID, actor }),
  );
  expect(chatToolsService.getShiftRoster).toHaveBeenCalledWith(
    { date: "2026-09-15", category: "NCS" },
    expect.objectContaining({ stationId: STATION_ID }),
  );
  expect(result.toolCalls).toHaveLength(2);
  expect(result.toolCalls[0].name).toBe("getCategoryRequirement");
  expect(result.toolCalls[0].result.categories[0].shortfall).toBe(2);
  expect(result.answer).toMatch(/short by 2/i);
  expect(result.outcome).toBe("answered");
  expect(prisma.chatConversationLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ outcome: "answered", stationId: STATION_ID }),
  }));
});

// Scenario 2: "Which departures tomorrow still need a releaser?"
it("surfaces the real unfilled-departure reasons from getDepartureManpower, not a generic message", async () => {
  chatToolsService.getDepartureManpower.mockResolvedValue({
    departures: [
      { flightRef: "QP-101", depTime: "06:00", releaser: null, releaserUnfilledReason: "all_busy_with_clash", support: "Bob" },
      { flightRef: "QP-202", depTime: "14:00", releaser: "Alice (B1)", releaserUnfilledReason: null, support: "Bob" },
    ],
  });
  geminiClient.generateContent
    .mockResolvedValueOnce({ functionCall: { name: "getDepartureManpower", args: { date: "2026-09-16" } }, text: "" })
    .mockResolvedValueOnce({ functionCall: null, text: "QP-101 at 06:00 still needs a releaser — everyone eligible is already committed to a clashing departure. QP-202 is covered." });

  const result = await chatAssistantService.askAssistant({ question: "Which departures tomorrow still need a releaser?", stationId: STATION_ID }, actor, req);

  expect(chatToolsService.getDepartureManpower).toHaveBeenCalledWith({ date: "2026-09-16" }, expect.objectContaining({ stationId: STATION_ID }));
  expect(result.toolCalls[0].result.departures[0].releaserUnfilledReason).toBe("all_busy_with_clash");
  expect(result.answer).toMatch(/QP-101/);
});

// Scenario 3: "What's not configured in the task master yet?"
it("lists the real zero-frequency task master entries from getTaskMasterStatus", async () => {
  chatToolsService.getTaskMasterStatus.mockResolvedValue({
    zeroFrequencyPlannedTasks: ["Layover Inspection", "A-Check"],
    zeroFrequencyUnplannedTasks: ["Wheel Change"],
    fullyConfigured: false,
  });
  geminiClient.generateContent
    .mockResolvedValueOnce({ functionCall: { name: "getTaskMasterStatus", args: {} }, text: "" })
    .mockResolvedValueOnce({ functionCall: null, text: "Layover Inspection and A-Check (planned) and Wheel Change (unplanned) have no frequency set yet." });

  const result = await chatAssistantService.askAssistant({ question: "What's not configured in the task master yet?", stationId: STATION_ID }, actor, req);

  expect(result.toolCalls[0].result.zeroFrequencyPlannedTasks).toEqual(["Layover Inspection", "A-Check"]);
  expect(result.answer).toMatch(/Layover Inspection/);
});

// Scenario 4: asking about a station outside the caller's access.
it("declines with a clear access-denied outcome instead of answering for a station the caller can't access, and never calls Gemini", async () => {
  const result = await chatAssistantService.askAssistant(
    { question: "How's coverage looking?", stationId: "some-station-this-actor-does-not-own" }, actor, req,
  );
  expect(result.outcome).toBe("access_denied");
  expect(geminiClient.generateContent).not.toHaveBeenCalled();
  expect(prisma.chatConversationLog.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ outcome: "access_denied" }),
  }));
});

// Scenario 5: no tool matches the question — the model itself declines.
it("returns an answered outcome with zero tool calls when Gemini declines rather than calling any tool", async () => {
  geminiClient.generateContent.mockResolvedValueOnce({
    functionCall: null, text: "I don't have a way to check the weather — I can only answer questions about rostering data for this station.",
  });
  const result = await chatAssistantService.askAssistant({ question: "What's the weather tomorrow?", stationId: STATION_ID }, actor, req);
  expect(result.toolCalls).toEqual([]);
  expect(result.outcome).toBe("answered");
  expect(result.answer).toMatch(/weather/i);
});

it("tells the model which OTHER stations exist so it can decline a cross-station question by name", async () => {
  geminiClient.generateContent.mockResolvedValueOnce({ functionCall: null, text: "Mumbai (BOM) isn't your current station — you're on Ahmedabad. Switch stations to ask about Mumbai." });
  await chatAssistantService.askAssistant({ question: "How's Mumbai's coverage?", stationId: STATION_ID }, actor, req);
  const [{ systemInstruction }] = geminiClient.generateContent.mock.calls[0];
  expect(systemInstruction).toMatch(/Ahmedabad/);
  expect(systemInstruction).toMatch(/Mumbai \(BOM\)/);
  expect(systemInstruction).toMatch(/do NOT call any tool/i);
});

it("stops after the turn limit instead of looping forever if the model never stops requesting tools", async () => {
  chatToolsService.getShiftRoster.mockResolvedValue({ entries: [] });
  geminiClient.generateContent.mockResolvedValue({ functionCall: { name: "getShiftRoster", args: { date: "2026-09-01" } }, text: "" });
  const result = await chatAssistantService.askAssistant({ question: "loop forever", stationId: STATION_ID }, actor, req);
  expect(result.answer).toMatch(/more steps/i);
  expect(geminiClient.generateContent.mock.calls.length).toBeLessThanOrEqual(5);
});

it("feeds a tool's thrown error back as that tool's result instead of crashing the conversation", async () => {
  chatToolsService.getShiftRoster.mockRejectedValue(new Error("boom"));
  geminiClient.generateContent
    .mockResolvedValueOnce({ functionCall: { name: "getShiftRoster", args: { date: "bad-date" } }, text: "" })
    .mockResolvedValueOnce({ functionCall: null, text: "I couldn't look that up." });
  const result = await chatAssistantService.askAssistant({ question: "who's on tomorrow", stationId: STATION_ID }, actor, req);
  expect(result.toolCalls[0].result).toEqual({ error: true, reason: "boom" });
  expect(result.answer).toBe("I couldn't look that up.");
});
