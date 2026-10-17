const reportService = require("../services/reportService");
const baRosterService = require("../services/baRosterService");
const peopleStrongRosterService = require("../services/peopleStrongRosterService");
const asyncHandler = require("../utils/asyncHandler");

const download = asyncHandler(async (req, res) => {
  const { type, format, stationId, monthKey, year, userId } = req.query;
  const report = await reportService.generateReport(type, format, { stationId, monthKey, year, userId });

  res.setHeader("Content-Type", report.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
  res.send(report.buffer);
});

const emailReport = asyncHandler(async (req, res) => {
  const { type, format, stationId, monthKey, year, toEmail } = req.body;
  const result = await reportService.emailReport(type, format, { stationId, monthKey, year }, toEmail, req.user, req);
  res.json(result);
});

const downloadBARoster = asyncHandler(async (req, res) => {
  const { stationId, fromDate, toDate } = req.query;
  const { buffer, filename } = await baRosterService.generateBARosterExcel(stationId, fromDate, toDate);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

const downloadPeopleStrongRoster = asyncHandler(async (req, res) => {
  const { stationId, monthKey } = req.query;
  const { buffer, filename } = await peopleStrongRosterService.generatePeopleStrongRosterExcel(stationId, monthKey);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

const peopleStrongRosterWarnings = asyncHandler(async (req, res) => {
  const { stationId, monthKey } = req.query;
  const result = await peopleStrongRosterService.getPeopleStrongRosterWarnings(stationId, monthKey);
  res.json(result);
});

module.exports = { download, emailReport, downloadBARoster, downloadPeopleStrongRoster, peopleStrongRosterWarnings };
