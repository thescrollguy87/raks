jest.mock("../src/repositories/officeLocationRepository");
jest.mock("../src/repositories/stationRepository");
jest.mock("../src/utils/auditTrail");

const officeLocationRepo = require("../src/repositories/officeLocationRepository");
const auditTrail = require("../src/utils/auditTrail");
const officeLocationService = require("../src/services/officeLocationService");

const stationManager = { sub: "mgr-1", roles: ["STATION_MANAGER"], permissions: ["attendance:manage"], stationId: "station-1", airlineId: "airline-1" };
const outsiderManager = { sub: "mgr-2", roles: ["STATION_MANAGER"], permissions: ["attendance:manage"], stationId: "station-2", airlineId: "airline-1" };

beforeEach(() => jest.clearAllMocks());

describe("officeLocationService.createLocation", () => {
  it("creates a location for the actor's own station", async () => {
    officeLocationRepo.create.mockResolvedValue({ id: "loc-1", stationId: "station-1", name: "Hangar 1", radiusMeters: 300 });

    const result = await officeLocationService.createLocation(
      { stationId: "station-1", name: "Hangar 1", latitude: 23.02, longitude: 72.57, radiusMeters: 300 },
      stationManager, {}
    );

    expect(result.id).toBe("loc-1");
    expect(officeLocationRepo.create).toHaveBeenCalledWith(expect.objectContaining({ stationId: "station-1", name: "Hangar 1" }));
    expect(auditTrail.recordCreate).toHaveBeenCalledWith("OfficeLocation", "loc-1", "station-1", stationManager, {});
  });

  it("rejects creating a location for a station that isn't the actor's own", async () => {
    await expect(officeLocationService.createLocation(
      { stationId: "station-1", name: "Hangar 1", latitude: 23.02, longitude: 72.57 },
      outsiderManager, {}
    )).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("officeLocationService.updateLocation / deleteLocation", () => {
  it("lets a station manager update their own station's location", async () => {
    officeLocationRepo.findById.mockResolvedValue({ id: "loc-1", stationId: "station-1", name: "Old", radiusMeters: 200, isActive: true });
    officeLocationRepo.update.mockResolvedValue({ id: "loc-1", stationId: "station-1", name: "New", radiusMeters: 250, isActive: true });

    const result = await officeLocationService.updateLocation("loc-1", { name: "New", radiusMeters: 250 }, stationManager, {});
    expect(result.name).toBe("New");
  });

  it("blocks updating another station's location", async () => {
    officeLocationRepo.findById.mockResolvedValue({ id: "loc-1", stationId: "station-2", name: "Old" });
    await expect(officeLocationService.updateLocation("loc-1", { name: "New" }, stationManager, {}))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("soft-deletes and audits", async () => {
    officeLocationRepo.findById.mockResolvedValue({ id: "loc-1", stationId: "station-1", name: "Hangar 1" });
    await officeLocationService.deleteLocation("loc-1", stationManager, {});
    expect(officeLocationRepo.softDelete).toHaveBeenCalledWith("loc-1", stationManager.sub);
    expect(auditTrail.recordDelete).toHaveBeenCalledWith("OfficeLocation", "loc-1", "station-1", stationManager, {});
  });
});
