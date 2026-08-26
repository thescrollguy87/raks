const nodemailer = require("nodemailer");
const env = require("../config/env");
const logger = require("../config/logger");

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host) {
    logger.warn("SMTP not configured — auth emails will be logged, not sent. Set SMTP_* in .env.");
    return null;
  }
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
  });
  return transporter;
}

async function send(to, subject, html, text, attachments) {
  const t = getTransporter();
  if (!t) {
    logger.info(`[email:not-configured] to=${to} subject="${subject}"${attachments ? ` attachments=${attachments.length}` : ""}`);
    return;
  }
  await t.sendMail({ from: env.smtp.from, to, subject, html, text, attachments });
}

// Convenience wrapper specifically for report delivery — buffer + filename
// in, sendMail's attachment shape out, so callers (reportService) don't need
// to know nodemailer's attachment format.
function sendReport(to, subject, message, filename, buffer, contentType) {
  return send(
    to, subject,
    `<p>${message}</p><p style="color:#888;font-size:12px">— RosterPro</p>`,
    message,
    [{ filename, content: buffer, contentType }]
  );
}

function sendVerificationEmail(user, token) {
  const link = `${env.appUrl}/verify-email?token=${token}`;
  return send(
    user.email,
    "Verify your RosterPro account",
    `<p>Hi ${user.fullName},</p><p>Confirm your email to activate your RosterPro account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
    `Hi ${user.fullName},\n\nConfirm your email: ${link}\n\nThis link expires in 24 hours.`
  );
}

function sendPasswordResetEmail(user, token) {
  const link = `${env.appUrl}/reset-password?token=${token}`;
  return send(
    user.email,
    "Reset your RosterPro password",
    `<p>Hi ${user.fullName},</p><p>We received a request to reset your password. This link is valid for 1 hour:</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
    `Hi ${user.fullName},\n\nReset your password: ${link}\n\nValid for 1 hour. If you didn't request this, ignore this email.`
  );
}

module.exports = { send, sendReport, sendVerificationEmail, sendPasswordResetEmail };
