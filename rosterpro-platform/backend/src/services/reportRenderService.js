const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { toCsv } = require("../utils/csv");

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

// ── CSV ───────────────────────────────────────────────────────────────────

function toCsvBuffer({ header, rows }) {
  return Buffer.from(toCsv([header, ...rows]), "utf8");
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

module.exports = { toExcelBuffer, toCsvBuffer, toPdfBuffer };
