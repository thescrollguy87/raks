const reportData = require("./reportDataService");
const render = require("./reportRenderService");
const emailService = require("./emailService");
const auditTrail = require("../utils/auditTrail");
const ApiError = require("../utils/ApiError");

// One registry entry per report type — adding a new report later means
// adding one entry here, not touching the controller, routes, or the
// format-rendering code at all.
const REPORT_TYPES = {
  roster: {
    title: (p) => `Roster — ${p.monthKey}`,
    fetch: (p) => reportData.getRosterReportData(p.stationId, p.monthKey),
    filename: (p) => `roster_${p.monthKey}`,
  },
  compliance: {
    title: () => "Compliance Status Report",
    fetch: (p) => reportData.getComplianceReportData(p.stationId),
    filename: (p) => `compliance_${p.stationId}`,
  },
  leave: {
    title: (p) => `Leave Balance — ${p.year}`,
    fetch: (p) => reportData.getLeaveReportData(p.stationId, p.year),
    filename: (p) => `leave_balance_${p.year}`,
  },
};

const CONTENT_TYPES = {
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv",
};
const EXTENSIONS = { excel: "xlsx", pdf: "pdf", csv: "csv" };

async function generateReport(type, format, params) {
  const def = REPORT_TYPES[type];
  if (!def) throw ApiError.badRequest(`Unknown report type: ${type}`);
  if (!CONTENT_TYPES[format]) throw ApiError.badRequest(`Unknown report format: ${format}`);

  const data = await def.fetch(params);
  const title = def.title(params);

  let buffer;
  if (format === "excel") buffer = await render.toExcelBuffer(data, title, title);
  else if (format === "pdf") buffer = await render.toPdfBuffer(data, title);
  else buffer = render.toCsvBuffer(data);

  return {
    buffer, title,
    filename: `${def.filename(params)}.${EXTENSIONS[format]}`,
    contentType: CONTENT_TYPES[format],
    meta: data.meta,
  };
}

async function emailReport(type, format, params, toEmail, actor, req) {
  const report = await generateReport(type, format, params);
  await emailService.sendReport(
    toEmail, report.title,
    `Attached: ${report.title} (generated ${new Date().toLocaleDateString("en-GB")}).`,
    report.filename, report.buffer, report.contentType
  );
  await auditTrail.logActivity("Report emailed", `${report.title} → ${toEmail}`, actor, req);
  return { sent: true, filename: report.filename };
}

module.exports = { generateReport, emailReport, REPORT_TYPES };
