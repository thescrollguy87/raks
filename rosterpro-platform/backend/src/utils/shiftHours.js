// Backend mirror of frontend/src/utils/shiftHours.js's shiftNetHours — kept
// in sync deliberately (same wrap-at-midnight and breakMin-subtraction
// formula ruleEngine.js's own private netHrs() already uses for DGCA hour-
// cap checks), but this version also supports a per-assignment time
// override (in1/out1, plus a second in2/out2 duty segment) the way a real,
// manually-edited roster assignment can carry — ruleEngine's netHrs() only
// ever looks at the shift definition's own fixed start/end, which undercounts
// (or overcounts) actual hours for any day someone's timing was hand-edited.
function segmentMinutes(inTime, outTime) {
  if (!inTime || !outTime) return 0;
  const [sh, sm] = inTime.split(":").map(Number);
  const [eh, em] = outTime.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // crosses midnight
  return mins;
}

// def: { startTime, endTime, breakMin } (a ShiftDefinition row, or an
// equivalent plain object). assignment: { in1, out1, in2, out2 } — a real
// ShiftAssignment row's per-day override fields, or omitted entirely to
// just use the shift definition's own fixed timing.
function shiftNetHours(def, assignment) {
  const in1 = assignment?.in1 || def?.startTime;
  const out1 = assignment?.out1 || def?.endTime;
  if (!in1 || !out1) return 0;
  let mins = segmentMinutes(in1, out1);
  if (assignment?.in2 && assignment?.out2) mins += segmentMinutes(assignment.in2, assignment.out2);
  return Math.max(0, (mins - (def?.breakMin || 0)) / 60);
}

module.exports = { shiftNetHours, segmentMinutes };
