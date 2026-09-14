jest.mock("../src/repositories/holidayRepository");
jest.mock("../src/repositories/stationRepository");
jest.mock("../src/utils/auditTrail");

const holidayRepo = require("../src/repositories/holidayRepository");
const stationRepo = require("../src/repositories/stationRepository");
const auditTrail = require("../src/utils/auditTrail");
const holidayService = require("../src/services/holidayService");

const stationManager = { sub: "mgr-1", roles: ["STATION_MANAGER"], permissions: ["holiday:manage", "holiday:read"], stationId: "station-1", airlineId: "airline-1" };
const airlineAdmin = { sub: "admin-1", roles: ["AIRLINE_ADMIN"], permissions: ["holiday:manage", "holiday:read"], airlineId: "airline-1" };
const staff = { sub: "staff-1", roles: ["AME"], permissions: ["holiday:read"], stationId: "station-1", airlineId: "airline-1" };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("holidayService.createHoliday", () => {
  it("defaults to the actor's own station when a station-scoped manager omits stationId", async () => {
    holidayRepo.create.mockResolvedValue({ id: "hol-1", stationId: "station-1" });

    await holidayService.createHoliday({ date: "2026-10-02", name: "Gandhi Jayanti" }, stationManager, {});

    expect(holidayRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      airlineId: "airline-1", stationId: "station-1", name: "Gandhi Jayanti",
    }));
    expect(auditTrail.recordCreate).toHaveBeenCalledWith("Holiday", "hol-1", "station-1", stationManager, {});
  });

  it("allows an Airline Admin to create an airline-wide holiday (no stationId)", async () => {
    holidayRepo.create.mockResolvedValue({ id: "hol-2", stationId: null });

    await holidayService.createHoliday({ date: "2026-01-26", name: "Republic Day" }, airlineAdmin, {});

    expect(holidayRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      airlineId: "airline-1", stationId: null, name: "Republic Day",
    }));
  });

  it("rejects a station-scoped manager naming a station that isn't their own", async () => {
    stationRepo.findStationAirlineId.mockResolvedValue({ airlineId: "airline-1" });
    await expect(holidayService.createHoliday(
      { date: "2026-10-02", name: "Test", stationId: "some-other-station" }, stationManager, {}
    )).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("holidayService.updateHoliday / deleteHoliday", () => {
  it("lets a Station Manager edit their own station's holiday", async () => {
    holidayRepo.findById.mockResolvedValue({ id: "hol-1", stationId: "station-1", airlineId: "airline-1", name: "Old Name", date: new Date("2026-10-02") });
    holidayRepo.update.mockResolvedValue({ id: "hol-1", stationId: "station-1", name: "New Name", date: new Date("2026-10-02") });

    const result = await holidayService.updateHoliday("hol-1", { name: "New Name" }, stationManager, {});
    expect(result.name).toBe("New Name");
  });

  it("blocks a plain staff member from managing a holiday (no holiday:manage permission at the route layer, defense-in-depth here too)", async () => {
    holidayRepo.findById.mockResolvedValue({ id: "hol-1", stationId: "station-2", airlineId: "airline-1", name: "X", date: new Date() });
    await expect(holidayService.updateHoliday("hol-1", { name: "Y" }, staff, {}))
      .rejects.toMatchObject({ statusCode: 404 }); // not their station -> assertOwnStation 404s
  });

  it("blocks a Station Manager from deleting another airline's/station's holiday", async () => {
    holidayRepo.findById.mockResolvedValue({ id: "hol-1", stationId: "other-station", airlineId: "airline-1", name: "X", date: new Date() });
    await expect(holidayService.deleteHoliday("hol-1", stationManager, {}))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("blocks a Station Manager from touching an airline-wide holiday belonging to another airline", async () => {
    holidayRepo.findById.mockResolvedValue({ id: "hol-1", stationId: null, airlineId: "airline-2", name: "X", date: new Date() });
    await expect(holidayService.deleteHoliday("hol-1", stationManager, {}))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("lets an Airline Admin delete an airline-wide holiday on their own airline", async () => {
    holidayRepo.findById.mockResolvedValue({ id: "hol-1", stationId: null, airlineId: "airline-1", name: "Republic Day", date: new Date() });
    await holidayService.deleteHoliday("hol-1", airlineAdmin, {});
    expect(holidayRepo.softDelete).toHaveBeenCalledWith("hol-1", airlineAdmin.sub);
    expect(auditTrail.recordDelete).toHaveBeenCalledWith("Holiday", "hol-1", null, airlineAdmin, {});
  });
});

describe("holidayService.listHolidays", () => {
  it("scopes a plain staff member to their own station (plus airline-wide entries, handled in the repo)", async () => {
    holidayRepo.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 });

    await holidayService.listHolidays(staff, {});

    expect(holidayRepo.list).toHaveBeenCalledWith(expect.objectContaining({
      airlineId: "airline-1", stationId: "station-1",
    }));
  });
});
