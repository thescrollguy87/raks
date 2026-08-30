const prisma = require("../config/prisma");

function listAdjustments(stationId, monthStart, monthEnd) {
  return prisma.dailyOperationalAdjustment.findMany({
    where: { stationId, date: { gte: monthStart, lt: monthEnd } },
    orderBy: { date: "asc" },
  });
}

function findAdjustment(id) {
  return prisma.dailyOperationalAdjustment.findUnique({ where: { id } });
}

function createAdjustment({ stationId, actorId, ...fields }) {
  return prisma.dailyOperationalAdjustment.create({ data: { stationId, createdById: actorId, ...fields } });
}

function deleteAdjustment(id) {
  return prisma.dailyOperationalAdjustment.delete({ where: { id } });
}

// Real rostered headcount for one calendar date, broken down by category —
// PUBLISHED roster only (a draft could still change before the date
// arrives, so it isn't a fact to compare against yet), on-duty shift types
// only (Morning/Afternoon/Night duty, not OFF/Leave).
async function getRosteredCountsByCategoryForDate(stationId, dateObj) {
  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      shiftDate: dateObj,
      deletedAt: null,
      roster: { stationId, isPublished: true },
      shiftDef: { type: { in: ["duty", "night"] } },
    },
    select: { user: { select: { category: true } } },
  });
  const counts = { B1: 0, B2: 0, CM: 0, NCS: 0 };
  assignments.forEach(a => {
    const cat = a.user?.category;
    if (cat && counts[cat] !== undefined) counts[cat]++;
    else counts.NCS++;
  });
  return counts;
}

module.exports = { listAdjustments, findAdjustment, createAdjustment, deleteAdjustment, getRosteredCountsByCategoryForDate };
