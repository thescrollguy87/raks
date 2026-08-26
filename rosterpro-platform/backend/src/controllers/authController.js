const authService = require("../services/authService");
const asyncHandler = require("../utils/asyncHandler");

// Controllers stay thin on purpose: parse/shape the HTTP request, call the
// service, shape the HTTP response. No business logic here — that's the
// point of having a service layer at all.

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req);
  res.json(result);
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body, req);
  res.json(result);
});

const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(req.body);
  res.json(result);
});

const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body, req);
  res.json(result);
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body, req);
  res.json(result);
});

const changePassword = asyncHandler(async (req, res) => {
  const result = await authService.changePassword(req.user.sub, req.body, req);
  res.json(result);
});

const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.sendVerificationEmail(req.user.sub);
  res.json(result);
});

const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body);
  res.json(result);
});

const setupMfa = asyncHandler(async (req, res) => {
  const result = await authService.setupMfa(req.user.sub);
  res.json(result);
});

const verifyMfa = asyncHandler(async (req, res) => {
  const result = await authService.verifyAndEnableMfa(req.user.sub, req.body, req);
  res.json(result);
});

const disableMfa = asyncHandler(async (req, res) => {
  const result = await authService.disableMfa(req.user.sub, req);
  res.json(result);
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

module.exports = {
  login, refresh, logout, forgotPassword, resetPassword, changePassword,
  resendVerification, verifyEmail, setupMfa, verifyMfa, disableMfa, me,
};
