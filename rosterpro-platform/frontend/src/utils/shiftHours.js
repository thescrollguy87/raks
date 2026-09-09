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
