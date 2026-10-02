// TASK ALLOCATION MODULE — regression coverage for eligibilityEngineService,
// specifically the self-overlap bug caught via live manual testing: the
// person CURRENTLY assigned to a task must not see that exact task listed
// as one of their OWN "existing assignments" (which would trivially
// "overlap" itself and wrongly fail NO_OVERLAP/TRAVEL_TIME for the very
// person already correctly doing it).
jest.mock("../src/repositories/maintenanceTaskRepository");
jest.mock("../src/repositories/taskAllocationConfigRepository");
jest.mock("../src/services/readOnlyRosterAdapter");

const maintenanceTaskRepo = require("../src/repositories/maintenanceTaskRepository");
const taskAllocationConfigRepo = require("../src/repositories/taskAllocationConfigRepository");
const readOnlyRosterAdapter = require("../src/services/readOnlyRosterAdapter");
const { buildCandidatesForTask, evaluateTask } = require("../src/services/eligibilityEngineService");

const STATION = "station-1";
const TASK = {
  id: "task-1", stationId: STATION, requiredCategory: "B1",
  plannedStart: "2026-10-02T19:30:00.000Z", latestStart: "2026-10-02T19:40:00.000Z", deadline: "2026-10-02T20:15:00.000Z",
  estimatedDurationMin: 45, location: "Stand 12", aircraftRegistration: "VT-XAA",
};

beforeEach(() => {
  jest.clearAllMocks();
  readOnlyRosterAdapter.getRosteredStaffForDate.mockResolvedValue({
    isPublished: true,
    staff: [{
      userId: "b1-staff", fullName: "B1 Staff", category: "B1", secondaryCategories: [], trainingPending: false,
      shiftCode: "N", shiftStart: "18:00", shiftEnd: "06:00",
    }],
  });
  readOnlyRosterAdapter.getLeaveSetForDate.mockResolvedValue(new Set());
  readOnlyRosterAdapter.getQualificationProfile.mockResolvedValue({
    qualifications: [{ qualCode: "B737 B1", status: "VALID" }], authorizations: [],
  });
  taskAllocationConfigRepo.listTravelTimes.mockResolvedValue([]);
});

it("excludes the task's OWN current assignment from the assigned person's existingAssignments — no false self-overlap", async () => {
  // The only existing assignment on the books for this person is THIS SAME
  // task (exact same window) — simulating re-opening the detail modal for
  // an already-assigned task.
  maintenanceTaskRepo.listActiveAssignmentsForUsers.mockResolvedValue([
    { userId: "b1-staff", taskId: "task-1", task: { ...TASK, id: "task-1" } },
  ]);

  const { isPublished, results } = await evaluateTask(STATION, TASK);
  expect(isPublished).toBe(true);
  const result = results.find(r => r.candidate.userId === "b1-staff");
  expect(result.candidate.existingAssignments).toHaveLength(0); // task-1 filtered out, not self-conflicting
  expect(result.eligible).toBe(true);
  expect(result.failedReasons).toHaveLength(0);
});

it("still correctly flags a genuine overlap with a DIFFERENT task", async () => {
  maintenanceTaskRepo.listActiveAssignmentsForUsers.mockResolvedValue([
    {
      userId: "b1-staff", taskId: "other-task",
      task: { id: "other-task", plannedStart: "2026-10-02T19:50:00.000Z", estimatedDurationMin: 30, location: "Stand 5", aircraftRegistration: "VT-XBB" },
    },
  ]);

  const { results } = await evaluateTask(STATION, TASK);
  const result = results.find(r => r.candidate.userId === "b1-staff");
  expect(result.candidate.existingAssignments).toHaveLength(1); // the OTHER task stays
  expect(result.eligible).toBe(false);
  expect(result.failedReasons).toContain("No impossible overlapping task");
});

it("buildCandidatesForTask returns isPublished:false with no candidates when nobody is rostered", async () => {
  readOnlyRosterAdapter.getRosteredStaffForDate.mockResolvedValue({ isPublished: false, staff: [] });
  const { isPublished, candidates } = await buildCandidatesForTask(STATION, TASK);
  expect(isPublished).toBe(false);
  expect(candidates).toHaveLength(0);
});
