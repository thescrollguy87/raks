jest.mock("../src/repositories/airlineRepository");
jest.mock("../src/utils/auditTrail");

const repo = require("../src/repositories/airlineRepository");
const auditTrail = require("../src/utils/auditTrail");
const airlineService = require("../src/services/airlineService");
const ApiError = require("../src/utils/ApiError");

const actor = { sub: "admin-1", roles: ["SUPER_ADMIN"] };

describe("airlineService.updateAirline", () => {
  it("throws 404 for an airline that doesn't exist", async () => {
    repo.findAirlineById.mockResolvedValue(null);
    await expect(airlineService.updateAirline("missing-id", { name: "Akasa Air" }, actor, {}))
      .rejects.toBeInstanceOf(ApiError);
  });

  it("renames the airline and records an audit trail entry", async () => {
    repo.findAirlineById.mockResolvedValue({ id: "airline-1", name: "Default Airline", icaoCode: "DEFAULT", iataCode: "DF", logoUrl: null });
    repo.updateAirline.mockResolvedValue({ id: "airline-1", name: "Akasa Air", icaoCode: "AKJ", iataCode: "QP", logoUrl: "https://example.com/logo.png" });

    const result = await airlineService.updateAirline(
      "airline-1",
      { name: "Akasa Air", icaoCode: "AKJ", iataCode: "QP", logoUrl: "https://example.com/logo.png" },
      actor, {}
    );

    expect(repo.updateAirline).toHaveBeenCalledWith(
      "airline-1",
      { name: "Akasa Air", icaoCode: "AKJ", iataCode: "QP", logoUrl: "https://example.com/logo.png" },
      actor.sub
    );
    expect(result.name).toBe("Akasa Air");
    expect(auditTrail.recordUpdate).toHaveBeenCalledWith(
      "Airline", "airline-1", null,
      expect.objectContaining({ name: "Default Airline" }),
      expect.objectContaining({ name: "Akasa Air" }),
      actor, {}
    );
  });
});
