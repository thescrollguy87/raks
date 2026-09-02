const asyncHandler = require("../utils/asyncHandler");
const userListRepo = require("../repositories/userListRepository");
const userService = require("../services/userService");
const staffImportService = require("../services/staffImportService");
const ApiError = require("../utils/ApiError");

// This endpoint is the reference implementation for how every Module 4
// domain list endpoint should look: requireAuth + requirePermission in the
// route, station/airline scoping applied here from the caller's own token
// (never trust a client-supplied stationId for scoping — only use it to
// narrow further within what the token already allows).
const list = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page || "1", 10);
  const pageSize = Math.min(parseInt(req.query.pageSize || "20", 10), 100);

  // SUPER_ADMIN/AIRLINE_ADMIN can see across the airline; everyone else is
  // scoped to their own station. This is the RBAC pattern extending beyond
  // "can you call this endpoint at all" into "which rows can you see."
  const scopedToStation = !req.user.roles.some(r => ["SUPER_ADMIN", "AIRLINE_ADMIN"].includes(r));

  // An airline-wide caller can optionally narrow to whichever station is
  // currently selected in the frontend's station switcher — a station-scoped
  // caller's own stationId always wins regardless of what they pass here.
  const stationId = scopedToStation ? req.user.stationId : (req.query.stationId || undefined);

  const result = await userListRepo.listPaginated({
    page, pageSize, stationId,
    airlineId: req.user.roles.includes("SUPER_ADMIN") ? undefined : req.user.airlineId,
  });
  res.json(result);
});

const create = asyncHandler(async (req, res) => {
  const result = await userService.createStaff(req.body, req.user, req);
  res.status(201).json(result);
});

const update = asyncHandler(async (req, res) => {
  const result = await userService.updateStaff(req.params.id, req.body, req.user, req);
  res.json(result);
});

const deactivate = asyncHandler(async (req, res) => {
  const result = await userService.setActive(req.params.id, false, req.user, req);
  res.json(result);
});

const reactivate = asyncHandler(async (req, res) => {
  const result = await userService.setActive(req.params.id, true, req.user, req);
  res.json(result);
});

const assignRoles = asyncHandler(async (req, res) => {
  const result = await userService.assignRoles(req.params.id, req.body.roles, req.user, req);
  res.json(result);
});

const remove = asyncHandler(async (req, res) => {
  const result = await userService.deleteStaff(req.params.id, req.user, req);
  res.json(result);
});

const importTemplate = asyncHandler(async (req, res) => {
  const buffer = await staffImportService.generateTemplate();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Employee_Master_Template.xlsx"`);
  res.send(buffer);
});

const importEmployeeMaster = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No file uploaded");
  const result = await staffImportService.importEmployeeMaster(req.query.stationId, req.file.buffer, req.user, req);
  res.json(result);
});

const exportEmployeeMaster = asyncHandler(async (req, res) => {
  const buffer = await staffImportService.exportEmployeeMaster(req.query.stationId);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Employee_Master.xlsx"`);
  res.send(buffer);
});

module.exports = {
  list, create, update, deactivate, reactivate, assignRoles, remove,
  importTemplate, importEmployeeMaster, exportEmployeeMaster,
};
