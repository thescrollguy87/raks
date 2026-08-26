const svc = require("../services/complianceService");
const asyncHandler = require("../utils/asyncHandler");

// Qualifications
const createQualification = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createQualification(req.body, req.user, req));
});
const updateQualification = asyncHandler(async (req, res) => {
  res.json(await svc.updateQualification(req.params.id, req.body, req.user, req));
});
const deleteQualification = asyncHandler(async (req, res) => {
  await svc.deleteQualification(req.params.id, req.user, req, req.query.reason);
  res.status(204).send();
});
const listQualifications = asyncHandler(async (req, res) => {
  res.json(await svc.listQualificationsForUser(req.params.userId));
});
const expiringQualifications = asyncHandler(async (req, res) => {
  res.json(await svc.listExpiringQualifications(parseInt(req.query.days, 10) || undefined));
});

// Licenses
const createLicense = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createLicense(req.body, req.user, req));
});
const updateLicense = asyncHandler(async (req, res) => {
  res.json(await svc.updateLicense(req.params.id, req.body, req.user, req));
});
const listLicenses = asyncHandler(async (req, res) => {
  res.json(await svc.listLicensesForUser(req.params.userId));
});
const expiringLicenses = asyncHandler(async (req, res) => {
  res.json(await svc.listExpiringLicenses(parseInt(req.query.days, 10) || undefined));
});

// Training
const createTraining = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createTraining(req.body, req.user, req));
});
const listTraining = asyncHandler(async (req, res) => {
  res.json(await svc.listTrainingForUser(req.params.userId));
});

// Authorizations
const createAuthorization = asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createAuthorization(req.body, req.user, req));
});
const listAuthorizations = asyncHandler(async (req, res) => {
  res.json(await svc.listAuthorizationsForUser(req.params.userId));
});

// Combined
const summary = asyncHandler(async (req, res) => {
  res.json(await svc.getComplianceSummary(req.params.userId));
});

module.exports = {
  createQualification, updateQualification, deleteQualification, listQualifications, expiringQualifications,
  createLicense, updateLicense, listLicenses, expiringLicenses,
  createTraining, listTraining,
  createAuthorization, listAuthorizations,
  summary,
};
