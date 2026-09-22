const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { toCsv } = require("../utils/csv");
const { deriveCellColors } = require("../utils/colorTint");

// ── Excel ─────────────────────────────────────────────────────────────────

async function toExcelBuffer({ header, rows }, sheetName, title) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RosterPro";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.replace(/[\\/*?:[\]]/g, "").slice(0, 31));

  ws.addRow(header);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2846" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  for (const row of rows) ws.addRow(row);

  ws.columns.forEach((col, i) => {
    const headerLen = String(header[i] ?? "").length;
    const maxLen = rows.reduce((m, r) => Math.max(m, String(r[i] ?? "").length), headerLen);
    col.width = Math.min(Math.max(maxLen + 2, 8), 40);
  });
  ws.views = [{ state: "frozen", ySplit: 1 }]; // keep header visible when scrolling

  return wb.xlsx.writeBuffer();
}

// ── Roster Excel (the real Monthly Roster layout) ───────────────────────────
//
// A dedicated builder, not the generic toExcelBuffer above — the Monthly
// Roster's actual file (see utils/rosterFileFormat.js) has a 4-row header
// (title+dates, weekdays, a blank spacer, then column labels) and a
// trailing shift-code legend, which the single-header-row/flat-rows shape
// toExcelBuffer assumes can't represent. Consumes the same
// {header, rows, meta} getRosterReportData/getRosterTemplateData produce —
// meta.shiftDefs feeds the legend, meta.title the title cell.
const DAY_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const ROSTER_LEADING_COLUMNS = 4; // S/N, Staff Name, Designation, Staff ID

async function toRosterExcelBuffer({ header, rows, meta }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RosterPro";
  wb.created = new Date();
  const ws = wb.addWorksheet((meta?.monthKey ? `Roster ${meta.monthKey}` : "Roster").replace(/[\\/*?:[\]]/g, "").slice(0, 31));

  const dayLabels = header.slice(ROSTER_LEADING_COLUMNS); // "YYYY-MM-DD" strings
  const dayDates = dayLabels.map(d => new Date(`${d}T00:00:00Z`));

  const titleRow = ws.addRow([meta?.title || "ROSTER", "", "", "", ...dayDates]);
  titleRow.font = { bold: true };
  dayDates.forEach((_, i) => { titleRow.getCell(ROSTER_LEADING_COLUMNS + 1 + i).numFmt = "dd-mmm-yyyy"; });

  ws.addRow(["", "", "", "", ...dayDates.map(d => DAY_ABBR[d.getUTCDay()])]);
  ws.addRow([]);

  const labelRow = ws.addRow(["S/N", "Staff Name", "Designation", "Staff ID", ...dayLabels.map(() => "")]);
  labelRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2846" } };
  });

  for (const r of rows) ws.addRow(r);

  ws.addRow([]);
  const legendHeader = ws.addRow(["Legends", "Description", "Timings"]);
  legendHeader.font = { bold: true };
  for (const def of meta?.shiftDefs || []) {
    ws.addRow([def.code, def.name, def.startTime && def.endTime ? `${def.startTime}-${def.endTime}` : "AS PER COMMENT"]);
  }

  ws.columns.forEach((col, i) => {
    const headerLen = String(header[i] ?? "").length;
    const maxLen = rows.reduce((m, r) => Math.max(m, String(r[i] ?? "").length), headerLen);
    col.width = Math.min(Math.max(maxLen + 2, i < ROSTER_LEADING_COLUMNS ? 10 : 6), 40);
  });
  ws.views = [{ state: "frozen", xSplit: ROSTER_LEADING_COLUMNS, ySplit: 4 }]; // staff info + header stay visible when scrolling

  return wb.xlsx.writeBuffer();
}

// ── CSV ───────────────────────────────────────────────────────────────────

function toCsvBuffer({ header, rows }) {
  return Buffer.from(toCsv([header, ...rows]), "utf8");
}

// ── Roster PDF (A3 landscape, category-grouped, color-coded) ────────────────
//
// Replicates the approved shift_roster_sample.pdf design exactly: a violet
// title band, a legend band spelling out every used shift code's clock
// time once, one violet-headed section per staff category, and a two-line
// cell (code + clock in/out) colored per the tenant's own Shift Definition
// color (see utils/colorTint.deriveCellColors — never a hardcoded
// palette). A3 landscape, not A4, because a full 30/31-day month with a
// two-line cell genuinely needs the extra width; column width and font
// size scale down together as the day count grows so a full month always
// fits without truncating a day or splitting a category's table across
// more pages than it has to.
const ROSTER_PDF_MARGIN = 40;
const ROSTER_PDF_HEADER_H = 58;
const ROSTER_PDF_LEGEND_GAP = 14;
const ROSTER_PDF_LEGEND_H = 26;
const ROSTER_PDF_CONTENT_GAP = 16;
const ROSTER_PDF_SECTION_HEADER_H = 22;
const ROSTER_PDF_TABLE_HEADER_H = 34;
const ROSTER_PDF_FOOTER_RESERVE = 34;
const ROSTER_PDF_PURPLE = "#4B1C95";
const ROSTER_PDF_LAVENDER = "#F0EBFF";
const ROSTER_PDF_LILAC_TEXT = "#D9CCF5";
const ROSTER_PDF_WHITE = "#FFFFFF";
const ROSTER_PDF_BORDER = "#E2E5EA";
const ROSTER_PDF_TEXT_DARK = "#241F33";
const ROSTER_PDF_FOOTER_GRAY = "#8A8698";
const ROSTER_PDF_STAFF_COL_W = 118;

function rosterPdfTimeCompact(t) { return t ? String(t).replace(":", "") : ""; }

// Column width shrinks as the month gets longer (12 sample days ≈ 81pt/day
// down to a 31-day month ≈ 31pt/day); font sizes scale down with it but
// never below a floor chosen to keep "HHMM-HHMM" legible at true A3 print
// scale — see the PDF export's own live verification for the smallest
// real case (a 31-day month).
function rosterPdfLayout(nDays, pageWidth) {
  const contentWidth = pageWidth - ROSTER_PDF_MARGIN * 2;
  const staffColWidth = ROSTER_PDF_STAFF_COL_W;
  const dayColWidth = (contentWidth - staffColWidth) / nDays;
  const codeFontSize = Math.max(6.5, Math.min(9, (dayColWidth / 68) * 9));
  const timeFontSize = Math.max(4.6, Math.min(7, (dayColWidth / 68) * 7));
  const rowHeight = 22;
  return { contentWidth, staffColWidth, dayColWidth, codeFontSize, timeFontSize, rowHeight };
}

function toRosterPdfBuffer(pdfData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A3", layout: "landscape", margin: 0, bufferPages: true });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.lineWidth(0.75);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const { meta, legend, dayLabels, categories } = pdfData;
    const layout = rosterPdfLayout(dayLabels.length, pageWidth);
    const M = ROSTER_PDF_MARGIN;

    function drawPageHeader() {
      doc.rect(0, 0, pageWidth, ROSTER_PDF_HEADER_H).fill(ROSTER_PDF_PURPLE);
      doc.fillColor(ROSTER_PDF_WHITE).font("Helvetica-Bold").fontSize(18).text("Shift Roster", M, 13, { lineBreak: false });
      doc.fillColor(ROSTER_PDF_LILAC_TEXT).font("Helvetica").fontSize(10)
        .text(`${meta.iataCode} — ${meta.stationName} Line Maintenance`, M, 36, { lineBreak: false });

      doc.font("Helvetica-Bold").fontSize(16);
      const monthW = doc.widthOfString(meta.monthLabel);
      doc.fillColor(ROSTER_PDF_WHITE).text(meta.monthLabel, pageWidth - M - monthW, 13, { lineBreak: false });
      const genLine = `Generated by RosterPro — ${meta.airlineName}`;
      doc.font("Helvetica").fontSize(9);
      const genW = doc.widthOfString(genLine);
      doc.fillColor(ROSTER_PDF_LILAC_TEXT).text(genLine, pageWidth - M - genW, 38, { lineBreak: false });

      const legendY = ROSTER_PDF_HEADER_H + ROSTER_PDF_LEGEND_GAP;
      doc.roundedRect(M, legendY, pageWidth - M * 2, ROSTER_PDF_LEGEND_H, 4).fill(ROSTER_PDF_LAVENDER);
      let lx = M + 14;
      const codeY = legendY + ROSTER_PDF_LEGEND_H / 2 - 5;
      const timeY = legendY + ROSTER_PDF_LEGEND_H / 2 - 4;
      for (const def of legend) {
        const { text } = deriveCellColors(def.color);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(text);
        doc.text(def.code, lx, codeY, { lineBreak: false });
        lx += doc.widthOfString(def.code) + 4;
        if (def.startTime && def.endTime) {
          const timeLabel = `[${rosterPdfTimeCompact(def.startTime)}-${rosterPdfTimeCompact(def.endTime)}]`;
          doc.font("Helvetica").fontSize(8).fillColor("#5B5570");
          doc.text(timeLabel, lx, timeY, { lineBreak: false });
          lx += doc.widthOfString(timeLabel) + 18;
        } else {
          lx += 18;
        }
      }
      return legendY + ROSTER_PDF_LEGEND_H + ROSTER_PDF_CONTENT_GAP;
    }

    function drawSectionHeader(y, label, count, continued) {
      doc.rect(M, y, layout.contentWidth, ROSTER_PDF_SECTION_HEADER_H).fill(ROSTER_PDF_PURPLE);
      doc.fillColor(ROSTER_PDF_WHITE).font("Helvetica-Bold").fontSize(11)
        .text(`${label} · ${count} staff${continued ? " (continued)" : ""}`, M + 10, y + 5, { lineBreak: false });
      return y + ROSTER_PDF_SECTION_HEADER_H;
    }

    function drawTableHeaderRow(y) {
      doc.rect(M, y, layout.contentWidth, ROSTER_PDF_TABLE_HEADER_H).fill(ROSTER_PDF_PURPLE);
      doc.fillColor(ROSTER_PDF_WHITE).font("Helvetica-Bold").fontSize(9)
        .text("Staff", M + 10, y + ROSTER_PDF_TABLE_HEADER_H / 2 - 5, { lineBreak: false });
      let x = M + layout.staffColWidth;
      const headFontSize = Math.min(9, layout.codeFontSize + 1);
      const weekFontSize = Math.max(6, Math.min(8, layout.timeFontSize + 1));
      for (const d of dayLabels) {
        doc.font("Helvetica-Bold").fontSize(headFontSize).fillColor(ROSTER_PDF_WHITE);
        const dayText = String(d.day);
        const w1 = doc.widthOfString(dayText);
        doc.text(dayText, x + (layout.dayColWidth - w1) / 2, y + 6, { lineBreak: false });
        doc.font("Helvetica").fontSize(weekFontSize).fillColor(ROSTER_PDF_LILAC_TEXT);
        const w2 = doc.widthOfString(d.weekday);
        doc.text(d.weekday, x + (layout.dayColWidth - w2) / 2, y + 19, { lineBreak: false });
        x += layout.dayColWidth;
      }
      doc.strokeColor(ROSTER_PDF_WHITE).moveTo(M + layout.staffColWidth, y).lineTo(M + layout.staffColWidth, y + ROSTER_PDF_TABLE_HEADER_H).stroke();
      return y + ROSTER_PDF_TABLE_HEADER_H;
    }

    function drawStaffRow(y, staff) {
      doc.rect(M, y, layout.staffColWidth, layout.rowHeight).fillAndStroke(ROSTER_PDF_WHITE, ROSTER_PDF_BORDER);
      doc.fillColor(ROSTER_PDF_TEXT_DARK).font("Helvetica-Bold").fontSize(9)
        .text(staff.fullName, M + 8, y + layout.rowHeight / 2 - 5, { width: layout.staffColWidth - 12, lineBreak: false, ellipsis: true });

      let x = M + layout.staffColWidth;
      for (const cell of staff.days) {
        const { bg, text } = deriveCellColors(cell.color);
        doc.rect(x, y, layout.dayColWidth, layout.rowHeight).fillAndStroke(bg, ROSTER_PDF_BORDER);
        doc.fillColor(text).font("Helvetica-Bold").fontSize(layout.codeFontSize);
        const codeW = doc.widthOfString(cell.code);
        const codeY = cell.hasTime ? y + 3 : y + (layout.rowHeight - layout.codeFontSize) / 2;
        doc.text(cell.code, x + (layout.dayColWidth - codeW) / 2, codeY, { lineBreak: false });
        if (cell.hasTime) {
          doc.font("Helvetica").fontSize(layout.timeFontSize);
          const timeW = doc.widthOfString(cell.timeLabel);
          doc.text(cell.timeLabel, x + (layout.dayColWidth - timeW) / 2, y + layout.rowHeight - layout.timeFontSize - 4, { lineBreak: false });
        }
        x += layout.dayColWidth;
      }
      return y + layout.rowHeight;
    }

    // Breaks to a new page (redrawing the standard page header + legend,
    // plus — when continuing mid-category — that category's own section
    // and day-header rows) whenever `needed` more points won't fit above
    // the footer reserve. `categoryCtx` is null for "about to start a
    // brand-new category" (no "(continued)" label needed even if it lands
    // on a fresh page) and {label,count} when breaking mid-table.
    function ensureSpace(y, needed, categoryCtx) {
      if (y + needed <= pageHeight - ROSTER_PDF_FOOTER_RESERVE) return y;
      doc.addPage();
      let ny = drawPageHeader();
      if (categoryCtx) {
        ny = drawSectionHeader(ny, categoryCtx.label, categoryCtx.count, true);
        ny = drawTableHeaderRow(ny);
      }
      return ny;
    }

    let y = drawPageHeader();
    for (const cat of categories) {
      y = ensureSpace(y, ROSTER_PDF_SECTION_HEADER_H + ROSTER_PDF_TABLE_HEADER_H + layout.rowHeight, null);
      y = drawSectionHeader(y, cat.label, cat.staff.length, false);
      y = drawTableHeaderRow(y);
      for (const s of cat.staff) {
        y = ensureSpace(y, layout.rowHeight, { label: cat.label, count: cat.staff.length });
        y = drawStaffRow(y, s);
      }
      y += ROSTER_PDF_CONTENT_GAP;
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(8).fillColor(ROSTER_PDF_FOOTER_GRAY)
        .text("Each cell shows the shift code and its clock in/out time on the second line — colored consistently with the on-screen roster.",
          M, pageHeight - 24, { lineBreak: false });
      const pageLabel = `Page ${i - range.start + 1} of ${range.count}`;
      const plw = doc.widthOfString(pageLabel);
      doc.text(pageLabel, pageWidth - M - plw, pageHeight - 24, { lineBreak: false });
    }

    doc.end();
  });
}

// ── PDF (hand-rolled table — PDFKit has no built-in table support) ──────────
//
// Renders a simple paginated table: fixed left margin, columns sized to fit
// the page width evenly, a repeated header row on every new page, and a
// page break whenever the next row would run past the bottom margin.
// Deliberately not fancy — this is a printable list/audit report, not a
// pixel-perfect layout tool.
function toPdfBuffer({ header, rows }, title) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: rows.length && header.length > 6 ? "landscape" : "portrait" });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / header.length;
    const rowHeight = 20;
    const bottomLimit = doc.page.height - doc.page.margins.bottom;

    function drawHeaderRow(y) {
      doc.font("Helvetica-Bold").fontSize(9);
      header.forEach((h, i) => {
        doc.text(String(h), doc.page.margins.left + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
      });
      doc.moveTo(doc.page.margins.left, y + rowHeight - 4)
        .lineTo(doc.page.width - doc.page.margins.right, y + rowHeight - 4)
        .strokeColor("#888888").stroke();
    }

    doc.font("Helvetica-Bold").fontSize(14).text(title, { align: "left" });
    doc.moveDown(0.5);
    let y = doc.y;
    drawHeaderRow(y);
    y += rowHeight;

    doc.font("Helvetica").fontSize(8);
    for (const row of rows) {
      if (y + rowHeight > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeaderRow(y);
        y += rowHeight;
        doc.font("Helvetica").fontSize(8);
      }
      row.forEach((cell, i) => {
        doc.text(String(cell ?? ""), doc.page.margins.left + i * colWidth, y, { width: colWidth - 4, ellipsis: true });
      });
      y += rowHeight;
    }

    doc.end();
  });
}

module.exports = { toExcelBuffer, toRosterExcelBuffer, toCsvBuffer, toPdfBuffer, toRosterPdfBuffer };
