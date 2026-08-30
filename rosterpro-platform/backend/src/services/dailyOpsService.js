const repo = require("../repositories/dailyOpsRepository");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");
const { assertOwnStation } = require("../utils/stationScope");

function monthRange(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

function listAdjustments(stationId, monthKey) {
  const { start, end } = monthRange(monthKey);
  return repo.listAdjustments(stationId, start, end);
}

async function createAdjustment(input, actor, req) {
  assertOwnStation(actor, input.stationId);
  const entry = await repo.createAdjustment({ ...input, actorId: actor.sub });
  await auditTrail.logActivity("Daily operational adjustment logged", `${entry.date.toISOString().slice(0, 10)}: ${entry.description}`, entry.stationId, actor, req);
  return entry;
}

async function deleteAdjustment(id, actor, req) {
  const entry = await repo.findAdjustment(id);
  if (!entry) throw ApiError.notFound("Daily operational adjustment not found");
  assertOwnStation(actor, entry.stationId);
  await repo.deleteAdjustment(id);
  await auditTrail.logActivity("Daily operational adjustment removed", `${entry.date.toISOString().slice(0, 10)}: ${entry.description}`, entry.stationId, actor, req);
  return { id };
}

// Compares what was logged as near-term operational reality against what's
// actually rostered for that date — informational only, this NEVER writes
// back to the roster. A shortfall of 0 is green; a shortfall of exactly 1
// is amber (worth a look, not yet a crisis); anything larger is red.
function statusForShortfall(shortfall) {
  if (shortfall <= 0) return "green";
  if (shortfall === 1) return "amber";
  return "red";
}

const STATUS_RANK = { green: 0, amber: 1, red: 2 };

async function getComparisonForMonth(stationId, monthKey) {
  const adjustments = await listAdjustments(stationId, monthKey);
  const results = [];
  for (const adj of adjustments) {
    const rostered = await repo.getRosteredCountsByCategoryForDate(stationId, adj.date);
    const byCategory = ["B1", "B2", "CM", "NCS"].map(cat => {
      const required = adj[`req${cat}`] || 0;
      const shortfall = Math.max(0, required - rostered[cat]);
      return { category: cat, required, rostered: rostered[cat], shortfall, status: statusForShortfall(shortfall) };
    });
    const overallStatus = byCategory.reduce((worst, c) => (STATUS_RANK[c.status] > STATUS_RANK[worst] ? c.status : worst), "green");
    results.push({ id: adj.id, date: adj.date, description: adj.description, byCategory, overallStatus });
  }
  return results;
}

module.exports = { listAdjustments, createAdjustment, deleteAdjustment, getComparisonForMonth };
