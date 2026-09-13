// Gemini function-calling declarations for the Roster Assistant. Pure data
// — no logic — describing exactly the arguments chatToolsService.js's
// functions accept. Deliberately NEVER includes a stationId/airlineId
// parameter on any tool: the model has no way to ask for a different
// station's data because there's nowhere in these schemas to put one —
// chatAssistantService.js always injects the caller's current session
// station/airline itself when it actually executes a call.
const DATE_DESC = "A specific calendar date in YYYY-MM-DD format.";
const SHIFT_DESC = "Which shift: Morning, Afternoon, or Night (or M/A/N).";

const TOOLS = [
  {
    name: "getCategoryRequirement",
    description: "Get the real combined staffing requirement (mandatory floor + workload-driven advisory sizing, whichever is higher) for every category (B1/B2/CM/NCS) on one date+shift, versus how many of each category are actually on the published roster that shift. Use for questions like 'do I have enough NCS Tuesday night' or 'are we short on B1 tomorrow morning'.",
    parameters: {
      type: "OBJECT",
      properties: {
        date: { type: "STRING", description: DATE_DESC },
        shift: { type: "STRING", description: SHIFT_DESC },
      },
      required: ["date", "shift"],
    },
  },
  {
    name: "getMandatoryCoverageStatus",
    description: "Check ONLY the configured Mandatory Minimum Coverage floor (a non-negotiable minimum, separate from workload-driven advisory sizing) for one date+shift — whether it's actually met on the published roster. Never conflate this with getCategoryRequirement's combined figure; use this specifically when the question is about the mandatory/critical floor.",
    parameters: {
      type: "OBJECT",
      properties: {
        date: { type: "STRING", description: DATE_DESC },
        shift: { type: "STRING", description: SHIFT_DESC },
      },
      required: ["date", "shift"],
    },
  },
  {
    name: "getShiftRoster",
    description: "List who is actually on the published roster for one specific date, optionally filtered to one category (B1, B2, CM, NCS, or STO). Use to answer 'who's working on <date>' or to see exactly which staff are covering a shift.",
    parameters: {
      type: "OBJECT",
      properties: {
        date: { type: "STRING", description: DATE_DESC },
        category: { type: "STRING", description: "Optional: B1, B2, CM, NCS, or STO." },
      },
      required: ["date"],
    },
  },
  {
    name: "getDepartureManpower",
    description: "Get the Releaser (B1/CM) and Support (NCS) manpower assignment status for every departure on one date, including the real reason a slot is unfilled (e.g. nobody rostered, or everyone eligible already committed to a clashing departure). Use for 'which departures need a releaser' or 'is tonight's departure covered'.",
    parameters: {
      type: "OBJECT",
      properties: { date: { type: "STRING", description: DATE_DESC } },
      required: ["date"],
    },
  },
  {
    name: "getFlightScheduleSummary",
    description: "Get the imported Flight Schedule's Operating Days, Total Movements, Average Daily Movements, and Peak Daily Movements (with its date) for one month.",
    parameters: {
      type: "OBJECT",
      properties: { month: { type: "STRING", description: "A month in YYYY-MM format." } },
      required: ["month"],
    },
  },
  {
    name: "getTaskMasterStatus",
    description: "List which Planned and Unplanned Task Master entries currently have zero frequency configured (so they contribute nothing to workload calculations yet) — answers 'what's not configured in the task master'.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "getComplianceStatus",
    description: "Get real hard-rule violations (rest-gap, max consecutive nights, max hours, night restrictions, etc.) against the published roster for a date range, defaulting to the current month if no dates are given.",
    parameters: {
      type: "OBJECT",
      properties: {
        dateRangeStart: { type: "STRING", description: "Optional start date, YYYY-MM-DD." },
        dateRangeEnd: { type: "STRING", description: "Optional end date, YYYY-MM-DD." },
      },
    },
  },
  {
    name: "getStaffNightCount",
    description: "Get exactly how many Night shifts a named staff member actually worked in a date range — use for 'who's working too many nights' or 'how many nights has X done this month'.",
    parameters: {
      type: "OBJECT",
      properties: {
        staffName: { type: "STRING", description: "The staff member's name (or a partial/unique part of it)." },
        dateRangeStart: { type: "STRING", description: "Start date, YYYY-MM-DD." },
        dateRangeEnd: { type: "STRING", description: "Optional end date, YYYY-MM-DD (defaults to start date)." },
      },
      required: ["staffName", "dateRangeStart"],
    },
  },
  {
    name: "getLeaveForDate",
    description: "List which staff have approved leave on a specific date.",
    parameters: {
      type: "OBJECT",
      properties: { date: { type: "STRING", description: DATE_DESC } },
      required: ["date"],
    },
  },
  {
    name: "listStaff",
    description: "Resolve a staff member by (partial) name, or list staff in a category — use this first whenever a question refers to someone by name and you need their exact record before calling another tool.",
    parameters: {
      type: "OBJECT",
      properties: {
        nameQuery: { type: "STRING", description: "Optional: a full or partial name to search for." },
        category: { type: "STRING", description: "Optional: B1, B2, CM, NCS, or STO." },
      },
    },
  },
];

module.exports = { TOOLS };
