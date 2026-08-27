const cron = require("node-cron");
const env = require("../config/env");
const logger = require("../config/logger");

const rosterRepo = require("../repositories/rosterRepository");
const notificationService = require("../services/notificationService");
const complianceService = require("../services/complianceService");

function shiftLabel(shiftDef) {
  if (!shiftDef.startTime) return shiftDef.name;
  return `${shiftDef.name} (${shiftDef.startTime}-${shiftDef.endTime})`;
}

// ── Job 1: daily "your shift tomorrow" reminder — requirement #2 ────────────
async function runDailyShiftReminders() {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  const assignments = await rosterRepo.findShiftsForDate(tomorrow);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  logger.info(`[job:daily-reminder] ${assignments.length} on-duty shifts for ${dateStr}`);

  let sent = 0, skipped = 0, failed = 0;
  for (const a of assignments) {
    if (!a.user?.isActive) continue;
    const result = await notificationService.notifyDailyShiftReminder(a.user, {
      shiftDate: dateStr, shiftLabel: shiftLabel(a.shiftDef),
    });
    if (result.skipped) skipped++;
    else if (result.sent) sent++;
    else failed++;
  }
  logger.info(`[job:daily-reminder] sent=${sent} skipped=${skipped} failed=${failed}`);
}

// ── Job 2: qualification & license expiry reminders ──────────────────────────
async function runComplianceExpiryReminders() {
  const [quals, licenses] = await Promise.all([
    complianceService.listExpiringQualifications(30),
    complianceService.listExpiringLicenses(30),
  ]);
  logger.info(`[job:compliance-expiry] ${quals.length} qualifications, ${licenses.length} licenses expiring within 30 days`);

  const now = Date.now();
  const daysLeft = (d) => Math.ceil((new Date(d).getTime() - now) / (24 * 60 * 60 * 1000));

  for (const q of quals) {
    if (!q.user) continue;
    await notificationService.notifyQualificationExpiring(q.user, {
      label: q.qualCode, expiryDate: q.expiryDate.toISOString().slice(0, 10), daysLeft: daysLeft(q.expiryDate),
    });
  }
  for (const l of licenses) {
    if (!l.user) continue;
    await notificationService.notifyQualificationExpiring(l.user, {
      label: `${l.category} License (${l.licenseNo})`, expiryDate: l.expiryDate.toISOString().slice(0, 10), daysLeft: daysLeft(l.expiryDate),
    });
  }
}

function startScheduler() {
  // Daily reminder: defaults to 18:00 station-local time, so staff get
  // tomorrow's shift the evening before.
  cron.schedule(env.dailyReminderCron || "0 18 * * *", () => {
    runDailyShiftReminders().catch(err => logger.error(`[job:daily-reminder] failed: ${err.message}`));
  }, { timezone: env.tz || "Asia/Kolkata" });

  // Compliance checks run once a day in the early morning — there's no
  // reason these need to be more frequent than daily, and running them
  // off-peak avoids competing with normal daytime traffic.
  cron.schedule("0 6 * * *", () => {
    runComplianceExpiryReminders().catch(err => logger.error(`[job:compliance-expiry] failed: ${err.message}`));
  }, { timezone: env.tz || "Asia/Kolkata" });

  logger.info("[scheduler] Notification jobs scheduled: daily reminder @18:00, compliance expiry @06:00");
}

module.exports = {
  startScheduler,
  runDailyShiftReminders, runComplianceExpiryReminders,
};
