// Net duty hours for one assignment — end minus start (wrapping past
// midnight for an overnight shift like Night), plus a second duty segment
// when present (a split-duty day like Break Shift), minus the shift
// definition's break, same formula reference-ui's shiftNetHrs used, extended
// for per-assignment time overrides. `assignment` may be undefined/null (an
// "O"/unassigned day) or an object with optional in1/out1/in2/out2
// overrides — falling back to the shift definition's own startTime/endTime
// when an override isn't set.
function segmentMinutes(inTime, outTime) {
  if (!inTime || !outTime) return 0;
  const [sh, sm] = inTime.split(":").map(Number);
  const [eh, em] = outTime.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins;
}

export function shiftNetHours(def, assignment) {
  const in1 = assignment?.in1 || def?.startTime;
  const out1 = assignment?.out1 || def?.endTime;
  if (!in1 || !out1) return 0;
  let mins = segmentMinutes(in1, out1);
  if (assignment?.in2 && assignment?.out2) {
    mins += segmentMinutes(assignment.in2, assignment.out2);
  }
  return Math.max(0, (mins - (def?.breakMin || 0)) / 60);
}

// Effective start/end time for one assignment (override, else the shift
// definition's default), plus which calendar date the shift actually ENDS
// on — an overnight shift like Night (21:00->07:00) ends on the day AFTER
// the one it's coded on, which matters for any rest-gap-between-shifts math.
export function effectiveShiftWindow(def, assignment, dateStr) {
  const in1 = assignment?.in1 || def?.startTime;
  const lastOut = (assignment?.in2 && assignment?.out2) ? assignment.out2 : (assignment?.out1 || def?.endTime);
  if (!in1 || !lastOut) return null;
  const overnight = toMinutes(lastOut) <= toMinutes(in1);
  return { in1, lastOut, endDateStr: overnight ? addOneDay(dateStr) : dateStr };
}

// Rest hours between the end of `fromWindow` (from effectiveShiftWindow, on
// fromDateStr) and the start of a shift beginning at `toDateStr toTime`.
// Returns null only when either side has no real time to compute from (e.g.
// Off/Leave) — a NEGATIVE result (today's shift starts before yesterday's
// even ends, e.g. Night 21:00-07:00 -> Morning 06:30 = -0.5h) is real,
// meaningful data, not a missing value: it's the worst-case rest violation,
// not the absence of one, so it must come back as a negative number for
// every caller's own `< minimum` check to actually catch it.
export function restGapHours(fromWindow, toDateStr, toTime) {
  if (!fromWindow || !toTime) return null;
  const [fh, fm] = fromWindow.lastOut.split(":").map(Number);
  const [th, tm] = toTime.split(":").map(Number);
  const fromMs = new Date(fromWindow.endDateStr + "T00:00:00Z").getTime() + (fh * 60 + fm) * 60000;
  const toMs = new Date(toDateStr + "T00:00:00Z").getTime() + (th * 60 + tm) * 60000;
  return (toMs - fromMs) / 3600000;
}

function toMinutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function addOneDay(dateStr) { const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

// Buckets a shift code into Morning/Afternoon/Night — matches this app's
// real shift-code convention (M/M1/MS, A/A1/A2/AS, N/N1/N2/N3 from the seed
// data) rather than assuming only literal "M"/"A"/"N" exist. Used by the
// Roster page's KPI row and Daily Coverage table, and by the Edit Shift
// popover's coverage-maintained check.
export function shiftBucket(code, def) {
  if (!code || code === "O") return null;
  if (def?.type === "night") return "N";
  if (code[0] === "M") return "M";
  if (code[0] === "A") return "A";
  return null;
}
