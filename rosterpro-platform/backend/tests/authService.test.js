// Mock every dependency of authService so these are true unit tests — no
// real database, no real network calls. This is what the repository/service
// split buys you: authService's logic (which error for which condition, when
// to issue tokens, when to send an email) is testable in isolation.

jest.mock("../src/repositories/userRepository");
jest.mock("../src/repositories/refreshTokenRepository");
jest.mock("../src/services/emailService");
jest.mock("../src/services/mfaService");
jest.mock("../src/utils/auditTrail");
jest.mock("../src/utils/password");
jest.mock("../src/utils/jwt");

const userRepo = require("../src/repositories/userRepository");
const refreshTokenRepo = require("../src/repositories/refreshTokenRepository");
const emailService = require("../src/services/emailService");
const mfaService = require("../src/services/mfaService");
const { hashPassword, comparePassword, isPasswordStrong } = require("../src/utils/password");
const { signAccessToken, generateRefreshToken, hashToken } = require("../src/utils/jwt");
const authService = require("../src/services/authService");
const ApiError = require("../src/utils/ApiError");

const baseUser = {
  id: "user-1", email: "rakesh@amd.example", fullName: "Rakesh Kumar Patel",
  passwordHash: "hashed", isActive: true, isEmailVerified: true,
  mfaEnabled: false, mfaSecret: null, airlineId: "airline-1", stationId: "station-1",
  category: "B1", designation: "Station I/C",
};

beforeEach(() => {
  userRepo.flattenRolesAndPermissions.mockReturnValue({ roles: ["STATION_MANAGER"], permissions: ["roster:read"] });
  signAccessToken.mockReturnValue("fake-access-token");
  generateRefreshToken.mockReturnValue("fake-refresh-token-plain");
  hashToken.mockReturnValue("fake-refresh-token-hash");
  refreshTokenRepo.create.mockResolvedValue({ id: "rt-1" });
  userRepo.updateLoginMeta.mockResolvedValue(baseUser);
});

describe("authService.login", () => {
  it("returns tokens and user on valid credentials", async () => {
    userRepo.findByEmail.mockResolvedValue(baseUser);
    comparePassword.mockResolvedValue(true);

    const result = await authService.login({ email: baseUser.email, password: "correct" }, { ip: "1.2.3.4" });

    expect(result.accessToken).toBe("fake-access-token");
    expect(result.refreshToken).toBe("fake-refresh-token-plain");
    expect(result.user.email).toBe(baseUser.email);
    expect(result.user.roles).toEqual(["STATION_MANAGER"]);
  });

  it("rejects an unknown email with a generic message (no enumeration)", async () => {
    userRepo.findByEmail.mockResolvedValue(null);
    await expect(authService.login({ email: "nobody@x.com", password: "x" }, {}))
      .rejects.toMatchObject({ statusCode: 401, message: "Invalid email or password" });
  });

  it("rejects a wrong password with the SAME generic message as unknown email", async () => {
    userRepo.findByEmail.mockResolvedValue(baseUser);
    comparePassword.mockResolvedValue(false);
    await expect(authService.login({ email: baseUser.email, password: "wrong" }, {}))
      .rejects.toMatchObject({ statusCode: 401, message: "Invalid email or password" });
  });

  it("rejects an inactive account even with correct credentials", async () => {
    userRepo.findByEmail.mockResolvedValue({ ...baseUser, isActive: false });
    comparePassword.mockResolvedValue(true);
    await expect(authService.login({ email: baseUser.email, password: "correct" }, {}))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it("blocks login before email verification", async () => {
    userRepo.findByEmail.mockResolvedValue({ ...baseUser, isEmailVerified: false });
    comparePassword.mockResolvedValue(true);
    await expect(authService.login({ email: baseUser.email, password: "correct" }, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("requires an MFA code when MFA is enabled, and flags it in details", async () => {
    userRepo.findByEmail.mockResolvedValue({ ...baseUser, mfaEnabled: true, mfaSecret: "enc-secret" });
    comparePassword.mockResolvedValue(true);
    await expect(authService.login({ email: baseUser.email, password: "correct" }, {}))
      .rejects.toMatchObject({ statusCode: 401, details: { mfaRequired: true } });
  });

  it("rejects an invalid MFA code", async () => {
    userRepo.findByEmail.mockResolvedValue({ ...baseUser, mfaEnabled: true, mfaSecret: "enc-secret" });
    comparePassword.mockResolvedValue(true);
    mfaService.verifyCode.mockReturnValue(false);
    await expect(authService.login({ email: baseUser.email, password: "correct", mfaCode: "000000" }, {}))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it("succeeds with a correct MFA code", async () => {
    userRepo.findByEmail.mockResolvedValue({ ...baseUser, mfaEnabled: true, mfaSecret: "enc-secret" });
    comparePassword.mockResolvedValue(true);
    mfaService.verifyCode.mockReturnValue(true);
    const result = await authService.login({ email: baseUser.email, password: "correct", mfaCode: "123456" }, {});
    expect(result.accessToken).toBe("fake-access-token");
  });
});

describe("authService.forgotPassword", () => {
  it("returns ok without sending an email when the address doesn't exist (no enumeration)", async () => {
    userRepo.findByEmail.mockResolvedValue(null);
    const result = await authService.forgotPassword({ email: "nobody@x.com" }, {});
    expect(result.ok).toBe(true);
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("sends a reset email and stores a token when the user exists", async () => {
    userRepo.findByEmail.mockResolvedValue(baseUser);
    await authService.forgotPassword({ email: baseUser.email }, {});
    expect(userRepo.setPasswordResetToken).toHaveBeenCalledWith(baseUser.id, expect.any(String), expect.any(Date));
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(baseUser, expect.any(String));
  });
});

describe("authService.resetPassword", () => {
  it("rejects a weak new password before touching the database", async () => {
    isPasswordStrong.mockReturnValue(false);
    await expect(authService.resetPassword({ token: "t", newPassword: "weak" }, {}))
      .rejects.toBeInstanceOf(ApiError);
    expect(userRepo.findByPasswordResetToken).not.toHaveBeenCalled();
  });

  it("rejects an invalid or expired token", async () => {
    isPasswordStrong.mockReturnValue(true);
    userRepo.findByPasswordResetToken.mockResolvedValue(null);
    await expect(authService.resetPassword({ token: "bad", newPassword: "GoodPass123" }, {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("updates the password and revokes all refresh tokens on success", async () => {
    isPasswordStrong.mockReturnValue(true);
    userRepo.findByPasswordResetToken.mockResolvedValue(baseUser);
    hashPassword.mockResolvedValue("new-hash");

    await authService.resetPassword({ token: "good", newPassword: "GoodPass123" }, {});

    expect(userRepo.updatePasswordHash).toHaveBeenCalledWith(baseUser.id, "new-hash");
    expect(refreshTokenRepo.revokeAllForUser).toHaveBeenCalledWith(baseUser.id);
  });
});

describe("authService.refresh", () => {
  it("rejects an unknown/expired refresh token", async () => {
    refreshTokenRepo.findValidByHash.mockResolvedValue(null);
    await expect(authService.refresh({ refreshToken: "nope" }, {}))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it("rotates the token: revokes the old one and issues a new pair", async () => {
    refreshTokenRepo.findValidByHash.mockResolvedValue({ id: "rt-1", userId: baseUser.id });
    userRepo.findById.mockResolvedValue(baseUser);

    const result = await authService.refresh({ refreshToken: "old-token" }, {});

    expect(refreshTokenRepo.revoke).toHaveBeenCalledWith("rt-1");
    expect(result.accessToken).toBe("fake-access-token");
    expect(result.refreshToken).toBe("fake-refresh-token-plain");
  });
});
