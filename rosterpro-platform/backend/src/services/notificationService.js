const notificationRepo = require("../repositories/notificationRepository");
const emailService = require("./emailService");
const whatsappService = require("./whatsappService");
const logger = require("../config/logger");

// The single choke point every notification goes through: record it first
// (so there's a durable row even if sending crashes), attempt delivery, then
// mark sent/failed. Callers never see a thrown error from this — a failed
// notification should never roll back or block the business operation that
// triggered it (e.g. a shift edit must still succeed even if the recipient's
// email bounces). Failures are visible via notificationRepo.listForUser /
// the notifications table, not via exceptions.
async function dispatch(user, channel, kind, subject, body) {
  if (!user?.id) return { skipped: true, reason: "no user" };
  const record = await notificationRepo.create({ userId: user.id, channel, kind, subject, body });
  try {
    if (channel === "EMAIL") {
      if (!user.email) throw new Error("No email address on file");
      const html = `<p>${body.split("\n").map(l => l || "&nbsp;").join("</p><p>")}</p><p style="color:#888;font-size:12px">— RosterPro</p>`;
      await emailService.send(user.email, subject, html, body);
    } else if (channel === "WHATSAPP") {
      await whatsappService.send(user.phone, body);
    }
    await notificationRepo.markSent(record.id);
    return { sent: true };
  } catch (err) {
    logger.warn(`Notification delivery failed [${channel}/${kind}] to user ${user.id}: ${err.message}`);
    await notificationRepo.markFailed(record.id, err);
    return { sent: false, error: err.message };
  }
}

// Fires a notification on every configured channel that makes sense for the
// kind, without one channel's failure affecting another's.
async function dispatchAll(user, channels, kind, subject, body) {
  const results = await Promise.all(channels.map(ch => dispatch(user, ch, kind, subject, body)));
  return results;
}

// ── Roster ────────────────────────────────────────────────────────────────

function notifyRosterPublished(users, { stationName, monthKey }) {
  const subject = `Roster published: ${monthKey}`;
  const body = `The ${monthKey} roster for ${stationName} has been published. Please check your shifts in RosterPro.`;
  return Promise.all(users.map(u => dispatch(u, "EMAIL", "roster_published", subject, body)));
}

function notifyRosterUnpublished(users, { stationName, monthKey, reason }) {
  const subject = `Roster revised: ${monthKey}`;
  const body = `The published ${monthKey} roster for ${stationName} has been reopened for changes.\nReason: ${reason}\n\nYour previously confirmed shifts may change — please check RosterPro before your next duty.`;
  return Promise.all(users.map(u => dispatch(u, "EMAIL", "roster_published", subject, body)));
}

// This is the #3 requirement from the original ask — WhatsApp (and email)
// the moment a specific person's shift changes. Fired from
// rosterService.upsertShift, only when the shift code actually changed.
function notifyShiftChanged(user, { shiftDate, oldCode, newCode }) {
  const subject = `Your shift on ${shiftDate} was changed`;
  const body = `Your shift on ${shiftDate} was changed from "${oldCode || "—"}" to "${newCode}".\nPlease check RosterPro for details.`;
  return dispatchAll(user, ["EMAIL", "WHATSAPP"], "change_alert", subject, body);
}

// ── Leave ─────────────────────────────────────────────────────────────────

function notifyLeaveDecision(user, { leaveType, fromDate, toDate, decision, reason }) {
  const verb = decision === "APPROVED" ? "approved" : "rejected";
  const subject = `Leave request ${verb}: ${fromDate} to ${toDate}`;
  const body = `Your ${leaveType} leave request (${fromDate} → ${toDate}) has been ${verb}.` + (reason ? `\nNote: ${reason}` : "");
  return dispatch(user, "EMAIL", "leave_approval", subject, body);
}

// ── Compliance (qualifications & licenses) ───────────────────────────────────

function notifyQualificationExpiring(user, { label, expiryDate, daysLeft }) {
  const urgency = daysLeft <= 0 ? "has EXPIRED" : `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  const subject = `${daysLeft <= 0 ? "EXPIRED" : "Expiring soon"}: ${label}`;
  const body = `Your qualification/license "${label}" ${urgency} (${expiryDate}).\nPlease arrange renewal as soon as possible.`;
  return dispatch(user, "EMAIL", "qualification_expiry", subject, body);
}

// ── Tools ─────────────────────────────────────────────────────────────────

function notifyToolCalibrationDue(users, { toolNo, description, calibrationDue }) {
  const subject = `Tool calibration due: ${toolNo}`;
  const body = `${toolNo} (${description}) is due for calibration on ${calibrationDue}. Please arrange calibration before this date to avoid it being blocked from issue.`;
  return Promise.all(users.map(u => dispatch(u, "EMAIL", "audit_due", subject, body)));
}

// ── Stores ────────────────────────────────────────────────────────────────

function notifyLowStock(users, { partNo, description, quantityOnHand, minStockLevel }) {
  const subject = `Low stock: ${partNo}`;
  const body = `${partNo} (${description}) is at ${quantityOnHand} on hand, below the minimum level of ${minStockLevel}. Please reorder.`;
  return Promise.all(users.map(u => dispatch(u, "EMAIL", "audit_due", subject, body)));
}

// ── Quality ───────────────────────────────────────────────────────────────

function notifyCapaOverdue(user, { correctiveAction, targetDate }) {
  const subject = `CAPA overdue: target date ${targetDate}`;
  const body = `A corrective action assigned to you is overdue:\n"${correctiveAction}"\nTarget date was ${targetDate}. Please update its status in RosterPro.`;
  return dispatch(user, "EMAIL", "audit_due", subject, body);
}

// ── Daily reminder (requirement #2 from the original ask) ───────────────────

async function notifyDailyShiftReminder(user, { shiftDate, shiftLabel }) {
  const already = await notificationRepo.findSentToday(user.id, "daily_reminder");
  if (already) return { skipped: true, reason: "already sent today" };

  const subject = `Your shift tomorrow (${shiftDate}): ${shiftLabel}`;
  const body = `Your duty for ${shiftDate} is: ${shiftLabel}`;
  return dispatch(user, "EMAIL", "daily_reminder", subject, body);
}

module.exports = {
  dispatch, dispatchAll,
  notifyRosterPublished, notifyRosterUnpublished, notifyShiftChanged,
  notifyLeaveDecision, notifyQualificationExpiring, notifyToolCalibrationDue,
  notifyLowStock, notifyCapaOverdue, notifyDailyShiftReminder,
};
