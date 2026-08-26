const reportService = require("../services/reportService");
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

module.exports = { download, emailReport };
