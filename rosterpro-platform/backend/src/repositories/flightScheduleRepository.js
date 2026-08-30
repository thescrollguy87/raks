const prisma = require("../config/prisma");

function findImport(stationId, year, month) {
  return prisma.flightScheduleImport.findUnique({
    where: { stationId_year_month: { stationId, year, month } },
    include: { turnRecords: true, charterRecords: true },
  });
}

// Re-importing the same station+month REPLACES the previous import rather
// than duplicating it — cascading the delete removes its turn/charter rows
// automatically (onDelete: Cascade on both), so a re-upload always reflects
// exactly the file just parsed, never a merge of old and new rows.
async function upsertImport({ stationId, year, month, turnRows, charterRows, actorId }) {
  const existing = await prisma.flightScheduleImport.findUnique({
    where: { stationId_year_month: { stationId, year, month } },
  });
  if (existing) await prisma.flightScheduleImport.delete({ where: { id: existing.id } });

  return prisma.flightScheduleImport.create({
    data: {
      stationId, year, month, importedById: actorId,
      turnRowCount: turnRows.length, charterRowCount: charterRows.length,
      turnRecords: {
        create: turnRows.map(r => ({
          aln: r.aln != null ? String(r.aln) : null,
          inboundFlt: r.inboundFlt != null ? String(r.inboundFlt) : null,
          inboundDepSta: r.inboundDepSta != null ? String(r.inboundDepSta) : null,
          inboundDepMin: r.inboundDepMin,
          inboundArrSta: r.inboundArrSta != null ? String(r.inboundArrSta) : null,
          inboundArrMin: r.inboundArrMin,
          groundTimeMin: r.groundTimeMin,
          outboundDepSta: r.outboundDepSta != null ? String(r.outboundDepSta) : null,
          outboundFlt: r.outboundFlt != null ? String(r.outboundFlt) : null,
          outboundDepMin: r.outboundDepMin,
          outboundArrSta: r.outboundArrSta != null ? String(r.outboundArrSta) : null,
          outboundArrMin: r.outboundArrMin,
          effectiveDate: r.effectiveDate,
          discontinueDate: r.discontinueDate,
          daysOfWeekPattern: r.daysOfWeek?.pattern ?? null,
          remark: r.remark != null ? String(r.remark) : null,
        })),
      },
      charterRecords: {
        create: charterRows.map(r => ({
          flightDesg: r.flightDesg != null ? String(r.flightDesg) : null,
          effectiveDate: r.effectiveDate,
          discontinueDate: r.discontinueDate,
          daysOfWeekPattern: r.daysOfWeek?.pattern ?? null,
          depSta: r.depSta != null ? String(r.depSta) : null,
          depMin: r.depMin,
          arrSta: r.arrSta != null ? String(r.arrSta) : null,
          arrMin: r.arrMin,
          serviceType: r.serviceType != null ? String(r.serviceType) : null,
        })),
      },
    },
    include: { turnRecords: true, charterRecords: true },
  });
}

module.exports = { findImport, upsertImport };
