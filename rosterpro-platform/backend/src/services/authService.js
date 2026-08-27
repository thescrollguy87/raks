const crypto = require("crypto");
const userRepo = require("../repositories/userRepository");
const refreshTokenRepo = require("../repositories/refreshTokenRepository");
const { hashPassword, comparePassword, isPasswordStrong } = require("../utils/password");
const { signAccessToken, generateRefreshToken, hashToken } = require("../utils/jwt");
const ApiError = require("../utils/ApiError");
const auditTrail = require("../utils/auditTrail");
const emailService = require("./emailService");
const mfaService = require("./mfaService");
const env = require("../config/env");

const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;
const MS_1_HOUR = 60 * 60 * 1000;
const MS_24_HOURS = 24 * 60 * 60 * 1000;

function toPublicUser(user, roles) {
  return {
    id: user.id, email: user.email, fullName: user.fullName,
    category: user.category, designation: user.designation,
    airlineId: user.airlineId, stationId: user.stationId,
    // Own-station display info for station-scoped roles — the frontend
    // can't call GET /api/stations for most of them (no station:read
    // permission), so this is the only way they learn their station's
    // name/IATA code to show in the header instead of hardcoding one.
    station: user.station ? { id: user.station.id, name: user.station.name, iataCode: user.station.iataCode } : null,
    roles, mfaEnabled: user.mfaEnabled, isEmailVerified: user.isEmailVerified,
  };
}

async function issueTokenPair(user, roles, permissions, req) {
  const accessToken = signAccessToken({ ...user, roles }, permissions);
  const refreshTokenPlain = generateRefreshToken();
  await refreshTokenRepo.create(
    user.id, hashToken(refreshTokenPlain), new Date(Date.now() + MS_30_DAYS),
    req?.ip, req?.headers?.["user-agent"]
  );
  return { accessToken, refreshToken: refreshTokenPlain };
}

async function login({ email, password, mfaCode }, req) {
  const user = await userRepo.findByEmail(email);
  // Same error for "no such user" and "wrong password" — don't let a login
  // form reveal which emails are registered.
  if (!user || !user.isActive) throw ApiError.unauthorized("Invalid email or password");

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("Invalid email or password");

  if (!user.isEmailVerified) throw ApiError.forbidden("Please verify your email before logging in");

  if (user.mfaEnabled) {
    if (!mfaCode) throw new ApiError(401, "MFA code required", { mfaRequired: true });
    if (!mfaService.verifyCode(user.mfaSecret, mfaCode)) throw ApiError.unauthorized("Invalid MFA code");
  }

  const { roles, permissions } = userRepo.flattenRolesAndPermissions(user);
  const tokens = await issueTokenPair(user, roles, permissions, req);
  await userRepo.updateLoginMeta(user.id, req?.ip);
  await auditTrail.logActivity("Login", user.email, user.stationId, { sub: user.id, name: user.fullName }, req);

  return { ...tokens, user: toPublicUser(user, roles) };
}

async function refresh({ refreshToken }, req) {
  const tokenHash = hashToken(refreshToken);
  const record = await refreshTokenRepo.findValidByHash(tokenHash);
  if (!record) throw ApiError.unauthorized("Invalid or expired refresh token");

  // Rotate on every use: revoke the old token, issue a new pair. This means
  // a stolen refresh token stops working the moment the real user refreshes
  // again, and reuse of a revoked token is a strong signal of theft (worth
  // alerting on in a future module).
  await refreshTokenRepo.revoke(record.id);

  const user = await userRepo.findById(record.userId);
  if (!user || !user.isActive) throw ApiError.unauthorized("Account is no longer active");

  const { roles, permissions } = userRepo.flattenRolesAndPermissions(user);
  const tokens = await issueTokenPair(user, roles, permissions, req);
  return { ...tokens, user: toPublicUser(user, roles) };
}

async function logout({ refreshToken }) {
  const tokenHash = hashToken(refreshToken);
  const record = await refreshTokenRepo.findValidByHash(tokenHash);
  if (record) await refreshTokenRepo.revoke(record.id);
  return { ok: true };
}

async function forgotPassword({ email }, req) {
  const user = await userRepo.findByEmail(email);
  // Always return success regardless of whether the email exists — prevents
  // account enumeration via the forgot-password form.
  if (!user) return { ok: true };

  const token = crypto.randomBytes(32).toString("hex");
  await userRepo.setPasswordResetToken(user.id, token, new Date(Date.now() + MS_1_HOUR));
  await emailService.sendPasswordResetEmail(user, token);
  await auditTrail.logActivity("Password reset requested", user.email, user.stationId, null, req);
  return { ok: true };
}

async function resetPassword({ token, newPassword }, req) {
  if (!isPasswordStrong(newPassword)) {
    throw ApiError.badRequest("Password must be at least 10 characters and include a letter and a number");
  }
  const user = await userRepo.findByPasswordResetToken(token);
  if (!user) throw ApiError.badRequest("Reset link is invalid or has expired");

  const passwordHash = await hashPassword(newPassword);
  await userRepo.updatePasswordHash(user.id, passwordHash);
  await refreshTokenRepo.revokeAllForUser(user.id); // force re-login everywhere
  await auditTrail.logActivity("Password reset completed", user.email, user.stationId, null, req);
  return { ok: true };
}

async function changePassword(userId, { currentPassword, newPassword }, req) {
  const user = await userRepo.findById(userId);
  if (!user) throw ApiError.notFound("User not found");

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) throw ApiError.unauthorized("Current password is incorrect");
  if (!isPasswordStrong(newPassword)) {
    throw ApiError.badRequest("Password must be at least 10 characters and include a letter and a number");
  }

  const passwordHash = await hashPassword(newPassword);
  await userRepo.updatePasswordHash(user.id, passwordHash);
  await refreshTokenRepo.revokeAllForUser(user.id);
  await auditTrail.logActivity("Password changed", user.email, user.stationId, { sub: userId, name: user.fullName }, req);
  return { ok: true };
}

async function sendVerificationEmail(userId) {
  const user = await userRepo.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  if (user.isEmailVerified) return { ok: true, alreadyVerified: true };

  const token = crypto.randomBytes(32).toString("hex");
  await userRepo.setEmailVerifyToken(user.id, token, new Date(Date.now() + MS_24_HOURS));
  await emailService.sendVerificationEmail(user, token);
  return { ok: true };
}

async function verifyEmail({ token }) {
  const user = await userRepo.findByEmailVerifyToken(token);
  if (!user) throw ApiError.badRequest("Verification link is invalid or has expired");
  await userRepo.markEmailVerified(user.id);
  return { ok: true };
}

async function setupMfa(userId) {
  const user = await userRepo.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  const { otpauthUrl, encrypted } = mfaService.generateSecret(user.email);
  await userRepo.setMfaSecret(userId, encrypted); // stored but mfaEnabled stays false until verified
  const qrCode = await mfaService.generateQrCodeDataUrl(otpauthUrl);
  return { qrCode, otpauthUrl };
}

async function verifyAndEnableMfa(userId, { code }, req) {
  const user = await userRepo.findById(userId);
  if (!user?.mfaSecret) throw ApiError.badRequest("Call setup first to generate a secret");
  if (!mfaService.verifyCode(user.mfaSecret, code)) throw ApiError.unauthorized("Invalid MFA code");
  await userRepo.setMfaEnabled(userId, true);
  await auditTrail.logActivity("MFA enabled", user.email, user.stationId, { sub: userId, name: user.fullName }, req);
  return { ok: true };
}

async function disableMfa(userId, req) {
  const user = await userRepo.findById(userId);
  await userRepo.setMfaEnabled(userId, false);
  await userRepo.setMfaSecret(userId, null);
  await auditTrail.logActivity("MFA disabled", user?.email, user?.stationId, { sub: userId, name: user?.fullName }, req);
  return { ok: true };
}

module.exports = {
  login, refresh, logout, forgotPassword, resetPassword, changePassword,
  sendVerificationEmail, verifyEmail, setupMfa, verifyAndEnableMfa, disableMfa,
  toPublicUser,
};
