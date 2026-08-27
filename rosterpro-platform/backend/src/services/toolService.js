const repo = require("../repositories/toolRepository");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const { assertOwnStation } = require("../utils/stationScope");

function toDate(iso) { return iso ? new Date(iso + "T00:00:00.000Z") : null; }

async function createTool(body, actor, req) {
  const data = {
    stationId: body.stationId, toolNo: body.toolNo, description: body.description,
    calibrationDue: toDate(body.calibrationDue),
    createdById: actor.sub, updatedById: actor.sub,
  };
  const tool = await repo.create(data);
  await auditTrail.recordCreate("Tool", tool.id, tool.stationId, actor, req);
  return tool;
}

async function recordCalibration(toolId, body, actor, req) {
  const tool = await repo.findById(toolId);
  if (!tool) throw ApiError.notFound("Tool not found");
  assertOwnStation(actor, tool.stationId);

  const calibratedOn = toDate(body.calibratedOn);
  const nextDue = toDate(body.nextDue);

  await repo.addCalibrationLog({
    toolId, calibratedOn, nextDue,
    certificateNo: body.certificateNo || null, attachmentId: body.attachmentId || null,
    createdById: actor.sub,
  });
  const updated = await repo.updateStatus(toolId, "VALID", nextDue);

  await auditTrail.recordUpdate(
    "Tool", toolId, tool.stationId,
    { status: tool.status, calibrationDue: tool.calibrationDue?.toISOString() },
    { status: "VALID", calibrationDue: nextDue.toISOString() },
    actor, req, `Calibrated ${body.calibratedOn}, next due ${body.nextDue}`
  );
  return updated;
}

async function issueTool(toolId, body, actor, req) {
  const tool = await repo.findById(toolId);
  if (!tool) throw ApiError.notFound("Tool not found");
  assertOwnStation(actor, tool.stationId);
  if (tool.status === "OVERDUE" || tool.status === "QUARANTINED") {
    throw ApiError.forbidden(`Tool is ${tool.status.toLowerCase()} and cannot be issued`);
  }

  const openIssues = await repo.findOpenIssuesForTool(toolId);
  if (openIssues.length > 0) throw ApiError.conflict("Tool is already issued and not yet returned");

  const issue = await repo.createIssue({
    toolId, issuedToId: body.issuedToId, workOrderRef: body.workOrderRef || null,
    createdById: actor.sub, updatedById: actor.sub,
  });
  await auditTrail.logActivity("Tool issued", `${tool.toolNo} → ${body.issuedToId}`, tool.stationId, actor, req);
  return issue;
}

async function returnTool(issueId, actor, req) {
  const issue = await repo.findOpenIssue(issueId);
  if (!issue) throw ApiError.notFound("Tool issue record not found");
  assertOwnStation(actor, issue.tool.stationId);
  if (issue.returnedAt) throw ApiError.conflict("This tool issue is already marked returned");

  const updated = await repo.returnIssue(issueId, actor.sub);
  await auditTrail.logActivity("Tool returned", issue.toolId, issue.tool.stationId, actor, req);
  return updated;
}

function listForStation(stationId) {
  return repo.listForStation(stationId);
}

function listDueForCalibration(days = 30) {
  return repo.listDueForCalibration(days);
}

module.exports = { createTool, recordCalibration, issueTool, returnTool, listForStation, listDueForCalibration };
