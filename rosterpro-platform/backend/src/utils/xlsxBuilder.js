const ExcelJS = require("exceljs");

// Shared "simple styled table" builder for every export/template in the
// Import/Export tab that doesn't need to match an external system's exact
// layout (unlike baRosterService, which mirrors a fixed third-party
// template) — bold white-on-navy header, frozen header row, content-fit
// column widths. Same visual language as reportRenderService's own report
// exports, so everything this app generates looks like one product.
//
// Pass `legend` (a short instruction string) when the file is a blank
// template for someone to fill in — it's written as its own row above the
// header, merged across every column, so it reads like a caption rather
// than a data row.
async function buildStyledSheet(sheetName, header, rows, { legend } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RosterPro";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.replace(/[\\/*?:[\]]/g, "").slice(0, 31));

  let headerRowIndex = 1;
  if (legend) {
    ws.addRow([legend]);
    ws.mergeCells(1, 1, 1, header.length);
    const legendCell = ws.getCell(1, 1);
    legendCell.font = { italic: true, color: { argb: "FF64748B" } };
    legendCell.alignment = { wrapText: true, vertical: "middle" };
    ws.getRow(1).height = 30;
    ws.addRow([]);
    headerRowIndex = 3;
  }

  const headerRow = ws.getRow(headerRowIndex);
  headerRow.values = header;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F2846" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  for (const row of rows) ws.addRow(row);

  ws.columns.forEach((col, i) => {
    const headerLen = String(header[i] ?? "").length;
    const maxLen = rows.reduce((m, r) => Math.max(m, String(r[i] ?? "").length), headerLen);
    col.width = Math.min(Math.max(maxLen + 2, 10), 40);
  });
  ws.views = [{ state: "frozen", ySplit: headerRowIndex }];

  return wb.xlsx.writeBuffer();
}

module.exports = { buildStyledSheet };
