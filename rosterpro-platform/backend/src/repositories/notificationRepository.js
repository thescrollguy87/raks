const prisma = require("../config/prisma");

function create({ userId, channel, kind, subject, body }) {
  return prisma.notification.create({ data: { userId, channel, kind, subject: subject || null, body } });
}

function markSent(id) {
  return prisma.notification.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
}

function markFailed(id, error) {
  return prisma.notification.update({ where: { id }, data: { status: "FAILED", error: String(error?.message || error) } });
}

function listForUser(userId, limit = 50) {
  return prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}

// Used by scheduled jobs to avoid sending the same reminder twice if a job
// is ever re-run the same day (e.g. after a server restart mid-run).
function findSentToday(userId, kind) {
  return prisma.notification.findFirst({
    where: { userId, kind, status: "SENT", createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });
}

module.exports = { create, markSent, markFailed, listForUser, findSentToday };
