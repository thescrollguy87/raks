jest.mock("../src/repositories/userRepository");
jest.mock("../src/repositories/stationRepository");
jest.mock("../src/utils/auditTrail");
jest.mock("../src/utils/password");

const userRepo = require("../src/repositories/userRepository");
const auditTrail = require("../src/utils/auditTrail");
const { hashPassword, isPasswordStrong } = require("../src/utils/password");
const userService = require("../src/services/userService");

const stationManager = { sub: "mgr-1", roles: ["STATION_MANAGER"], permissions: ["staff:update"], stationId: "station-1", airlineId: "airline-1" };

const existingUser = {
  id: "u1", fullName: "Dip Prajapati", email: "dip.prajapati@akasaair.com", employeeId: "702720",
  category: "CM", designation: "C.M", stationId: "station-1", airlineId: "airline-1",
  reportsToId: null, roles: [{ role: { name: "CM", permissions: [] } }],
};

beforeEach(() => {
  jest.clearAllMocks();
  userRepo.findById.mockResolvedValue(existingUser);
  userRepo.update.mockImplementation((id, data) => Promise.resolve({ ...existingUser, ...data }));
  userRepo.flattenRolesAndPermissions.mockReturnValue({ roles: ["CM"], permissions: [] });
});

describe("userService.updateStaff — email", () => {
  it("leaves the email untouched when it isn't included in the update", async () => {
    await userService.updateStaff("u1", { fullName: "Dip Prajapati" }, stationManager, {});

    expect(userRepo.findByEmail).not.toHaveBeenCalled();
    expect(userRepo.update).toHaveBeenCalledWith("u1", expect.not.objectContaining({ email: expect.anything() }));
  });

  it("rejects an email already used by a different staff member", async () => {
    userRepo.findByEmail.mockResolvedValue({ id: "someone-else" });

    await expect(userService.updateStaff("u1", { email: "taken@akasaair.com" }, stationManager, {}))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it("allows setting the email back to what it already is (no-op, no uniqueness check)", async () => {
    await userService.updateStaff("u1", { email: existingUser.email }, stationManager, {});
    expect(userRepo.findByEmail).not.toHaveBeenCalled();
  });

  it("updates the email and records it in the audit trail", async () => {
    userRepo.findByEmail.mockResolvedValue(null); // not used by anyone else

    await userService.updateStaff("u1", { email: "new.email@akasaair.com" }, stationManager, {});

    expect(userRepo.update).toHaveBeenCalledWith("u1", expect.objectContaining({ email: "new.email@akasaair.com" }));
    expect(auditTrail.recordUpdate).toHaveBeenCalledWith(
      "User", "u1", "station-1", existingUser,
      expect.objectContaining({ email: "new.email@akasaair.com" }),
      stationManager, {}
    );
  });
});

describe("userService.updateStaff — password", () => {
  it("leaves the password untouched when the field is omitted", async () => {
    await userService.updateStaff("u1", { fullName: "Dip Prajapati" }, stationManager, {});

    expect(hashPassword).not.toHaveBeenCalled();
    expect(userRepo.update).toHaveBeenCalledWith("u1", expect.not.objectContaining({ passwordHash: expect.anything() }));
    expect(auditTrail.logActivity).not.toHaveBeenCalled();
  });

  it("rejects a weak password without writing anything", async () => {
    isPasswordStrong.mockReturnValue(false);

    await expect(userService.updateStaff("u1", { password: "weak" }, stationManager, {}))
      .rejects.toMatchObject({ statusCode: 400 });

    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it("hashes a strong password, writes it, and logs a password-reset activity entry with no value attached", async () => {
    isPasswordStrong.mockReturnValue(true);
    hashPassword.mockResolvedValue("hashed-secret");

    await userService.updateStaff("u1", { password: "NewPassw0rd!" }, stationManager, {});

    expect(hashPassword).toHaveBeenCalledWith("NewPassw0rd!");
    expect(userRepo.update).toHaveBeenCalledWith("u1", expect.objectContaining({ passwordHash: "hashed-secret" }));
    expect(auditTrail.logActivity).toHaveBeenCalledWith(
      "Password reset", expect.stringContaining(existingUser.fullName), "station-1", stationManager, {}
    );
  });

  it("never includes the password hash in the audit-trail field diff", async () => {
    isPasswordStrong.mockReturnValue(true);
    hashPassword.mockResolvedValue("hashed-secret");

    await userService.updateStaff("u1", { password: "NewPassw0rd!" }, stationManager, {});

    const auditAfterArg = auditTrail.recordUpdate.mock.calls[0][4];
    expect(auditAfterArg).not.toHaveProperty("passwordHash");
  });
});
