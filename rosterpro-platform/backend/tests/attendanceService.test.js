jest.mock("../src/repositories/attendanceRepository");
jest.mock("../src/repositories/officeLocationRepository");
jest.mock("../src/utils/auditTrail");

const attendanceRepo = require("../src/repositories/attendanceRepository");
const officeLocationRepo = require("../src/repositories/officeLocationRepository");
const attendanceService = require("../src/services/attendanceService");

const actor = { sub: "staff-1", stationId: "station-1" };

const hangar = { id: "loc-hangar", name: "Hangar 1", latitude: 23.0225, longitude: 72.5714, radiusMeters: 300, isActive: true };
const office = { id: "loc-office", name: "Office", latitude: 23.5, longitude: 73.0, radiusMeters: 100, isActive: true };

// Deliberately a few meters off the hangar's exact coordinates, never
// exactly on top of them — a real GPS fix always carries some jitter, and
// looksLikeMockLocation() specifically flags an exact 0.0m match as a
// spoofing tell, so test fixtures need to look like a real reading too.
function punchBody(overrides = {}) {
  return {
    lat: 23.02255, lng: 72.57145, accuracy: 12.4,
    capturedAt: "2026-09-16T02:00:00.000Z", // 07:30 IST
    photoBase64: "data:image/jpeg;base64,/9j/", // small placeholder
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  attendanceRepo.findByUserAndDate.mockResolvedValue(null);
  attendanceRepo.findScheduledShift.mockResolvedValue(null);
  attendanceRepo.create.mockImplementation(async (data) => ({ id: "att-1", ...data }));
  attendanceRepo.update.mockImplementation(async (id, data) => ({ id, ...data }));
  officeLocationRepo.listActiveForStation.mockResolvedValue([hangar, office]);
});

describe("attendanceService.isExemptShiftType", () => {
  it("treats duty/night as not exempt", () => {
    expect(attendanceService.isExemptShiftType("duty")).toBe(false);
    expect(attendanceService.isExemptShiftType("night")).toBe(false);
  });
  it("treats leave/off/other (deputation) as exempt", () => {
    expect(attendanceService.isExemptShiftType("leave")).toBe(true);
    expect(attendanceService.isExemptShiftType("off")).toBe(true);
    expect(attendanceService.isExemptShiftType("other")).toBe(true);
  });
  it("is false for 'no shift type known' — callers combine this with their own shiftDef-exists check", () => {
    // isExemptShiftType judges a known type only; "no shift scheduled at
    // all" is a distinct condition every call site checks separately
    // (see regularizationService.createRequest's own `!shiftDef` check) —
    // conflating the two here would make a genuinely un-rostered day look
    // no different from a real leave/deputation day.
    expect(attendanceService.isExemptShiftType(undefined)).toBe(false);
  });
});

describe("attendanceService.punchIn — distance matching against multiple locations", () => {
  it("succeeds when within radius of the nearer of two configured locations", async () => {
    const record = await attendanceService.punchIn(punchBody(), actor, {});
    expect(record.punchInLocationId).toBe("loc-hangar");
    expect(record.punchInDistanceM).toBeLessThan(hangar.radiusMeters);
  });

  it("succeeds when within radius of the farther location even if outside the nearer one's radius", async () => {
    officeLocationRepo.listActiveForStation.mockResolvedValue([
      { id: "loc-tight", name: "Tight", latitude: 23.0225, longitude: 72.5714, radiusMeters: 5, isActive: true },
      { id: "loc-wide", name: "Wide", latitude: 23.03, longitude: 72.58, radiusMeters: 5000, isActive: true },
    ]);
    const record = await attendanceService.punchIn(punchBody({ lat: 23.0301, lng: 72.5801 }), actor, {});
    expect(record.punchInLocationId).toBe("loc-wide");
  });

  it("rejects a punch outside every configured location's radius", async () => {
    await expect(attendanceService.punchIn(punchBody({ lat: 25.0, lng: 75.0 }), actor, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects when the station has no office locations configured at all", async () => {
    officeLocationRepo.listActiveForStation.mockResolvedValue([]);
    await expect(attendanceService.punchIn(punchBody(), actor, {})).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("attendanceService.punchIn — offline capture timestamp preservation", () => {
  it("stores the client-captured timestamp as punchInAt, not the server's receipt time", async () => {
    const capturedAt = "2026-09-10T02:00:00.000Z"; // days in the past — simulating a late offline sync
    const record = await attendanceService.punchIn(punchBody({ capturedAt }), actor, {});
    expect(record.punchInAt.toISOString()).toBe(capturedAt);
    expect(record.punchInSyncedAt).not.toEqual(record.punchInAt);
  });

  it("buckets the attendance record under the captured date, not today's date", async () => {
    const record = await attendanceService.punchIn(punchBody({ capturedAt: "2026-09-10T02:00:00.000Z" }), actor, {});
    expect(record.date.toISOString().slice(0, 10)).toBe("2026-09-10");
  });
});

describe("attendanceService.punchIn — mock location rejection", () => {
  it("rejects a punch reporting exactly-zero GPS accuracy", async () => {
    await expect(attendanceService.punchIn(punchBody({ accuracy: 0 }), actor, {}))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("attendanceService.punchIn — late detection against the scheduled shift", () => {
  it("marks ON_TIME when punching within the grace window of the scheduled start", async () => {
    attendanceRepo.findScheduledShift.mockResolvedValue({
      shiftDefId: "sd-1", shiftDef: { code: "M", type: "duty", startTime: "07:30", endTime: "15:30" },
    });
    const record = await attendanceService.punchIn(punchBody({ capturedAt: "2026-09-16T02:03:00.000Z" }), actor, {}); // 07:33 IST, 3 min late
    expect(record.status).toBe("ON_TIME");
  });

  it("marks LATE when punching well after the scheduled start", async () => {
    attendanceRepo.findScheduledShift.mockResolvedValue({
      shiftDefId: "sd-1", shiftDef: { code: "M", type: "duty", startTime: "07:30", endTime: "15:30" },
    });
    const record = await attendanceService.punchIn(punchBody({ capturedAt: "2026-09-16T02:25:00.000Z" }), actor, {}); // 07:55 IST, 25 min late
    expect(record.status).toBe("LATE");
  });
});

describe("attendanceService.punchOut — early-out detection", () => {
  it("marks EARLY_OUT when leaving well before the scheduled end", async () => {
    attendanceRepo.findByUserAndDate.mockResolvedValue({
      id: "att-1", punchInAt: new Date("2026-09-16T02:00:00.000Z"), punchOutAt: null, status: "ON_TIME",
    });
    attendanceRepo.findScheduledShift.mockResolvedValue({
      shiftDefId: "sd-1", shiftDef: { code: "M", type: "duty", startTime: "07:30", endTime: "15:30" },
    });
    const record = await attendanceService.punchOut(punchBody({ capturedAt: "2026-09-16T09:00:00.000Z" }), actor, {}); // 14:30 IST, 1hr early
    expect(record.status).toBe("EARLY_OUT");
  });

  it("rejects punching out twice", async () => {
    attendanceRepo.findByUserAndDate.mockResolvedValue({ id: "att-1", punchOutAt: new Date() });
    await expect(attendanceService.punchOut(punchBody(), actor, {})).rejects.toMatchObject({ statusCode: 409 });
  });
});
