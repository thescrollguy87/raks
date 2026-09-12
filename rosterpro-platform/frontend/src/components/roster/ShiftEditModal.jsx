import { useState, useEffect, useMemo } from "react";
import { getComplianceSummary } from "../../api/compliance.js";
import { listLeave } from "../../api/leave.js";
import { shiftBucket, effectiveShiftWindow, restGapHours } from "../../utils/shiftHours.js";

// A handful of the most common codes get a one-click button (matches the
// reference popover's [M][A][N][O][L] row); anything else — this app's
// real shift-definition list runs to two dozen+ codes (M1, MS, A1, A2, AS,
// N1-N3, BS, FS, SOD, TRG, ...) — is still reachable via the full dropdown
// right below it, so no existing shift code becomes unreachable.
const QUICK_CODES = ["M", "A", "N", "O", "L"];

export default function ShiftEditModal({ cell, shiftDefs, staff, monthKey, mandatoryRules, onSave, onClose }) {
  const [shiftCode, setShiftCode] = useState(cell.currentCode || "O");
  const initialDef = shiftDefs.find(d => d.code === (cell.currentCode || "O"));
  const [in1, setIn1] = useState(cell.currentIn1 || initialDef?.startTime || "");
  const [out1, setOut1] = useState(cell.currentOut1 || initialDef?.endTime || "");
  const [in2, setIn2] = useState(cell.currentIn2 || "");
  const [out2, setOut2] = useState(cell.currentOut2 || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [compliance, setCompliance] = useState(null);
  const [approvedLeaves, setApprovedLeaves] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getComplianceSummary(cell.userId).catch(() => null),
      listLeave({ userId: cell.userId, status: "APPROVED", pageSize: 50 }).catch(() => null),
    ]).then(([comp, leaveRes]) => {
      if (cancelled) return;
      setCompliance(comp);
      setApprovedLeaves(Array.isArray(leaveRes) ? leaveRes : leaveRes?.items || []);
    });
    return () => { cancelled = true; };
  }, [cell.userId]);

  const def = shiftDefs.find(d => d.code === shiftCode);
  // A working shift type (duty/night) needs a time, even one like Break
  // Shift or Flexi Shift whose OWN definition deliberately carries no
  // startTime/endTime — those are exactly the codes where the real time is
  // meant to be set per day, not off/leave/other codes which have none at all.
  const isTimed = def?.type === "duty" || def?.type === "night";
  const isBreakShift = shiftCode === "BS"; // split-duty day: a second in/out segment

  function handleShiftCodeChange(newCode) {
    setShiftCode(newCode);
    // Re-fill IN-1/OUT-1 from the newly selected shift's own default times —
    // still editable afterward, just a sensible starting point per shift.
    const newDef = shiftDefs.find(d => d.code === newCode);
    setIn1(newDef?.startTime || "");
    setOut1(newDef?.endTime || "");
    if (newCode !== "BS") { setIn2(""); setOut2(""); }
  }

  // Real, computed validation — nothing here is a static checkmark. Each
  // row reads from data already loaded (the full month's roster grid,
  // mandatory coverage rules) or one small per-staff fetch made when this
  // popover opened (compliance summary, approved leave).
  const checks = useMemo(() => {
    const staffObj = staff.find(s => s.id === cell.userId);
    const rows = [];

    // 1) Qualified for duty
    if (compliance === null) {
      rows.push({ level: "warn", text: "Checking qualification status…" });
    } else if (compliance.isBlocked) {
      rows.push({ level: "crit", text: "Qualification issue — one or more required quals/licenses/training/authorizations have expired" });
    } else {
      rows.push({ level: "ok", text: "Qualified for duty" });
    }

    // 2) Rest requirement — gap from the previous day's shift end into this
    // one, and from this shift's end into the next day's already-scheduled
    // start, each checked against the 12h DGCA guideline this app already
    // surfaces elsewhere (Coverage page's 48h/7-day rolling cap context).
    if (staffObj && isTimed && in1) {
      const prevDateStr = shiftDate(monthKey, dayOf(cell.dateStr) - 1);
      const nextDateStr = shiftDate(monthKey, dayOf(cell.dateStr) + 1);
      const prevA = prevDateStr && staffObj.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === prevDateStr);
      const nextA = nextDateStr && staffObj.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === nextDateStr);
      const prevDef = prevA && shiftDefs.find(d => d.code === prevA.shiftDef.code);
      const nextDef = nextA && shiftDefs.find(d => d.code === nextA.shiftDef.code);

      const prevWindow = prevA ? effectiveShiftWindow(prevDef, prevA, prevDateStr) : null;
      const gapBefore = prevWindow ? restGapHours(prevWindow, cell.dateStr, in1) : null;

      const thisWindow = effectiveShiftWindow(def, { in1, out1, in2, out2 }, cell.dateStr);
      const nextIn1 = nextA ? (nextA.in1 || nextDef?.startTime) : null;
      const gapAfter = (thisWindow && nextIn1) ? restGapHours(thisWindow, nextDateStr, nextIn1) : null;

      const worst = [gapBefore, gapAfter].filter(g => g !== null).sort((a, b) => a - b)[0];
      if (worst !== undefined && worst < 12) {
        rows.push({ level: "crit", text: `Rest period only ${worst.toFixed(1)}h — below the 12h minimum` });
      } else {
        rows.push({ level: "ok", text: "Rest requirement satisfied" });
      }
    } else {
      rows.push({ level: "ok", text: "Rest requirement satisfied" });
    }

    // 3) No leave conflict — an approved leave request covering this date
    // while the shift being set is a real working shift.
    const hasLeaveConflict = isTimed && approvedLeaves?.some(l => cell.dateStr >= l.fromDate.slice(0, 10) && cell.dateStr <= l.toDate.slice(0, 10));
    if (approvedLeaves === null) {
      rows.push({ level: "warn", text: "Checking leave records…" });
    } else if (hasLeaveConflict) {
      rows.push({ level: "crit", text: "Conflicts with an approved leave request covering this date" });
    } else {
      rows.push({ level: "ok", text: "No leave conflict" });
    }

    // 4) Coverage maintained — if this edit moves the staff member OUT of
    // their current shift bucket, would the category still meet its
    // Mandatory Coverage minimum (Rule Builder's own configured minCount)?
    if (staffObj) {
      const oldDef = shiftDefs.find(d => d.code === cell.currentCode);
      const oldBucket = shiftBucket(cell.currentCode, oldDef);
      const newBucket = shiftBucket(shiftCode, def);
      if (oldBucket && oldBucket !== newBucket) {
        const category = staffObj.category || "NCS";
        const rule = mandatoryRules.find(r => r.category === category && r.shift === oldBucket && r.enabled);
        if (rule) {
          const others = staff.filter(s => s.id !== cell.userId && (s.category || "NCS") === category).filter(s => {
            const a = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === cell.dateStr);
            return a && shiftBucket(a.shiftDef.code, shiftDefs.find(d => d.code === a.shiftDef.code)) === oldBucket;
          }).length;
          if (others < rule.minCount) {
            rows.push({ level: "crit", text: `Coverage gap — ${category} ${oldBucket} would drop to ${others}, below the required minimum of ${rule.minCount}` });
          } else {
            rows.push({ level: "ok", text: "Coverage maintained" });
          }
        } else {
          rows.push({ level: "ok", text: "Coverage maintained" });
        }
      } else {
        rows.push({ level: "ok", text: "Coverage maintained" });
      }
    }

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compliance, approvedLeaves, shiftCode, in1, out1, in2, out2, staff, shiftDefs, mandatoryRules, cell, isTimed, def]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onSave({
        shiftCode, reason: reason || undefined,
        in1: isTimed ? (in1 || undefined) : undefined,
        out1: isTimed ? (out1 || undefined) : undefined,
        in2: isTimed && isBreakShift ? (in2 || undefined) : undefined,
        out2: isTimed && isBreakShift ? (out2 || undefined) : undefined,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="popover-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="popover-title">{cell.staffName}</div>
        <div className="popover-sub">{cell.dateLabel}</div>

        <div className="pop-current">
          <span className="pop-current-code">{cell.currentCode}</span>
          <span className="pop-current-time">{initialDef?.startTime ? `${cell.currentIn1 || initialDef.startTime}–${cell.currentOut1 || initialDef.endTime}` : initialDef?.name}</span>
        </div>

        <div className="fl" style={{ marginBottom: 6 }}>Change Shift</div>
        <div className="quick-shift-row">
          {QUICK_CODES.filter(c => shiftDefs.some(d => d.code === c)).map(c => (
            <button key={c} className={`quick-shift-btn${shiftCode === c ? " sel" : ""}`} onClick={() => handleShiftCodeChange(c)}>{c}</button>
          ))}
        </div>
        <div className="fg" style={{ marginBottom: 12 }}>
          <select className="fi" value={shiftCode} onChange={(e) => handleShiftCodeChange(e.target.value)}>
            {shiftDefs.map(d => (
              <option key={d.code} value={d.code}>{d.code} — {d.name}</option>
            ))}
          </select>
        </div>

        {isTimed && (
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">IN-1</label>
              <input className="fi" type="time" value={in1} onChange={(e) => setIn1(e.target.value)} />
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">OUT-1</label>
              <input className="fi" type="time" value={out1} onChange={(e) => setOut1(e.target.value)} />
            </div>
          </div>
        )}

        {isTimed && isBreakShift && (
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">IN-2 (BS only)</label>
              <input className="fi" type="time" value={in2} onChange={(e) => setIn2(e.target.value)} />
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">OUT-2 (BS only)</label>
              <input className="fi" type="time" value={out2} onChange={(e) => setOut2(e.target.value)} />
            </div>
          </div>
        )}

        <div className="fl" style={{ marginBottom: 4 }}>Validation</div>
        <div className="validation-list">
          {checks.map((c, i) => (
            <div key={i} className={`validation-row ${c.level}`}>
              <span className="vr-icon">{c.level === "ok" ? "✓" : c.level === "crit" ? "⚠" : "…"}</span>
              <span>{c.text}</span>
            </div>
          ))}
        </div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Reason (recorded in audit trail)</label>
          <input
            className="fi" type="text" placeholder="e.g. Swap with staff on request"
            value={reason} onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function dayOf(dateStr) { return Number(dateStr.slice(8, 10)); }
function shiftDate(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInM = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (day < 1 || day > daysInM) return null;
  return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
}
