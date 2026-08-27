const reportService = require("../services/reportService");
const baRosterService = require("../services/baRosterService");
const asyncHandler = require("../utils/asyncHandler");

const download = asyncHandler(async (req, res) => {
  const { type, format, stationId, monthKey, year } = req.query;
  const report = await reportService.generateReport(type, format, { stationId, monthKey, year });

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
  const { stationId, date } = req.query;
  const { buffer, filename } = await baRosterService.generateBARosterExcel(stationId, date);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = { download, emailReport, downloadBARoster };
