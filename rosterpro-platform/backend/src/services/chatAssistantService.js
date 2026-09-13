// Orchestrates one "Roster Assistant" question: resolves the caller's
// current session scope, runs Gemini's function-calling loop against the
// real tools in chatToolsService.js, and logs the full exchange for audit.
//
// CRITICAL: this file drives the loop but never itself decides what the
// answer IS — Gemini only ever sees real tool outputs and phrases them;
// this file's own logic is limited to scope resolution, dispatch, guarding
// against a runaway loop, and logging. If you're tempted to add "just
// compute X here so the model doesn't have to ask" — don't; add a tool.
const prisma = require("../config/prisma");
const stationRepo = require("../repositories/stationRepository");
const geminiClient = require("../integrations/geminiClient");
const chatToolsService = require("./chatToolsService");
const { TOOLS } = require("../utils/chatToolDefinitions");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { assertOwnStation, resolveAirlineId } = require("../utils/stationScope");

const MAX_TOOL_TURNS = 5; // guards against a runaway function-calling loop

function buildSystemPrompt({ stationName, stationIataCode, airlineName, otherStations }) {
  const otherList = otherStations.length
    ? otherStations.map(s => `${s.name} (${s.iataCode})`).join(", ")
    : "none — this is the only active station on this airline";

  return [
    "You are the Roster Assistant inside RosterPro, a line-maintenance staff rostering platform for an airline's ground/maintenance stations.",
    "",
    `CURRENT SESSION CONTEXT — Airline: "${airlineName}". Station: "${stationName}" (${stationIataCode}).`,
    `Every tool call you make is automatically scoped ONLY to this station — you cannot see or affect any other station's data no matter what arguments you pass.`,
    `Other stations that exist on this airline (for your awareness ONLY — you must NOT answer questions about them): ${otherList}.`,
    "If the user's question names a specific station or airline other than the current one above, or otherwise clearly isn't about the current station, do NOT call any tool. Instead, plainly tell them which station is currently active and that they should switch the station selector (in the sidebar) to ask about a different one.",
    "",
    "HARD RULES:",
    "- You NEVER perform roster math, constraint-checking, or date/calendar arithmetic yourself. Every number or fact in your answer must come directly from a tool's real returned value — you only translate the question into the right tool call(s) and phrase the real result back in plain language.",
    "- If a question needs information no available tool can provide (it's outside rostering entirely, e.g. weather, or asks you to invent/estimate a number), say so plainly and decline. Never guess.",
    "- When a question names a specific person, call listStaff first if you're not certain of their exact record, then use that result in any follow-up tool call.",
    "- Use the app's own terminology precisely: Releaser (B1 or CM), Support (NCS), Mandatory Minimum Coverage (a non-negotiable floor) vs advisory/workload-driven sizing (a separate concept — never conflate the two), Task Master, Departure Manpower.",
    "- Be concise. Answer the question directly, then stop.",
    "- You are answering from real backend data via tool calls, not from general knowledge — if asked, say so honestly.",
  ].join("\n");
}

async function resolveSessionContext(actor, stationId) {
  await assertOwnStation(actor, stationId);
  const airlineId = await resolveAirlineId(actor, stationId);
  const stationsInAirline = await stationRepo.listStations({ airlineId, isSuperAdmin: false });
  const current = stationsInAirline.find(s => s.id === stationId);
  return {
    airlineId,
    stationName: current?.name || "your station",
    stationIataCode: current?.iataCode || "",
    airlineName: current?.airlineName || "your airline",
    otherStations: stationsInAirline.filter(s => s.id !== stationId),
  };
}

async function logConversation({ actor, stationId, airlineId, question, answer, toolCalls, outcome, req }) {
  try {
    await prisma.chatConversationLog.create({
      data: {
        userId: actor?.sub || null,
        userName: actor?.name || "Unknown",
        stationId: stationId || null,
        airlineId: airlineId || null,
        question,
        answer,
        toolCalls: toolCalls && toolCalls.length ? toolCalls : undefined,
        outcome,
        ipAddress: req?.ip || null,
      },
    });
  } catch (err) {
    // Logging failure must never take down an otherwise-successful answer.
    // eslint-disable-next-line no-console
    console.error("Failed to log chat conversation:", err.message);
  }
}

async function askAssistant(input, actor, req) {
  const question = (input.question || "").trim();
  const stationId = input.stationId;
  if (!question) throw ApiError.badRequest("question is required");
  if (!stationId) throw ApiError.badRequest("stationId is required — the currently-selected station");

  let session;
  try {
    session = await resolveSessionContext(actor, stationId);
  } catch (err) {
    const answer = "You don't have access to that station, so I can't answer this. Switch to a station you have access to and ask again.";
    await logConversation({ actor, stationId, airlineId: null, question, answer, toolCalls: [], outcome: "access_denied", req });
    return { answer, toolCalls: [], outcome: "access_denied" };
  }

  const systemInstruction = buildSystemPrompt(session);
  const contents = [{ role: "user", parts: [{ text: question }] }];
  const toolCallsLog = [];
  let finalAnswer = null;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const result = await geminiClient.generateContent({ systemInstruction, contents, tools: TOOLS });

    if (!result.functionCall) {
      finalAnswer = result.text || "I wasn't able to come up with an answer to that.";
      break;
    }

    const { name, args } = result.functionCall;
    const toolFn = chatToolsService[name];
    let toolResult;
    if (!toolFn) {
      toolResult = { error: true, reason: `No tool named "${name}" exists in this system.` };
    } else {
      try {
        toolResult = await toolFn(args || {}, { actor, stationId, airlineId: session.airlineId, req });
      } catch (err) {
        toolResult = { error: true, reason: err.message || "That tool call failed." };
      }
    }
    toolCallsLog.push({ name, args: args || {}, result: toolResult });

    contents.push({ role: "model", parts: [{ functionCall: { name, args: args || {} } }] });
    contents.push({ role: "function", parts: [{ functionResponse: { name, response: { name, content: toolResult } } }] });
  }

  if (!finalAnswer) {
    finalAnswer = "That question needed more steps than I'm allowed to take — try asking something more specific.";
  }

  const outcome = "answered";
  await logConversation({
    actor, stationId, airlineId: session.airlineId, question, answer: finalAnswer,
    toolCalls: toolCallsLog, outcome, req,
  });
  await auditTrail.logActivity(
    "Roster Assistant question answered",
    `"${question}" — ${toolCallsLog.length} tool call(s): ${toolCallsLog.map(t => t.name).join(", ") || "none"}`,
    stationId, actor, req,
  );

  return {
    answer: finalAnswer,
    toolCalls: toolCallsLog.map(t => ({ name: t.name, args: t.args, result: t.result })),
    outcome,
  };
}

// stationId/stationIdIn mirror auditRepository's own scoping shape (see
// resolveStationScope) — a specific station once verified, or every
// station the caller's own airline actually has when none was named,
// never "no filter" for an airline-wide caller.
async function listConversationLog(params) {
  const { stationId, stationIdIn, from, to, page = 1, pageSize = 50 } = params;
  const where = {
    ...(stationId ? { stationId } : stationIdIn ? { stationId: { in: stationIdIn } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.chatConversationLog.count({ where }),
    prisma.chatConversationLog.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
    }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

module.exports = { askAssistant, listConversationLog };
