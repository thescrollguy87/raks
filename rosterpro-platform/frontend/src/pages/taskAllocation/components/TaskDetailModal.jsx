// TASK ALLOCATION MODULE — task detail + candidates + "why was this person
// assigned" (Section 16) + manual assignment/override (Sections 17-18) +
// reallocate (Section 19), shared by the Task Board and Unassigned pages.
import { useState, useEffect, useCallback } from "react";
import * as taApi from "../../../api/taskAllocation.js";

const TRIGGERS = [
  "MANUAL", "FLIGHT_DELAY", "FLIGHT_CANCELLATION", "AIRCRAFT_SWAP", "NEW_DEFECT",
  "TASK_OVERRUN", "STAFF_ABSENCE", "STAFF_UNAVAILABLE", "NEW_TASK", "TASK_CANCELLATION", "STAND_CHANGE", "OPERATIONAL_DISRUPTION",
];

export default function TaskDetailModal({ stationId, taskId, onClose, onChanged }) {
  const [task, setTask] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showReallocate, setShowReallocate] = useState(false);
  const [trigger, setTrigger] = useState("MANUAL");
  const [triggerDetail, setTriggerDetail] = useState("");

  const load = useCallback(() => {
    Promise.all([
      taApi.getTask(stationId, taskId),
      taApi.getCandidates(stationId, taskId).catch(() => null),
    ]).then(([t, c]) => { setTask(t); setCandidates(c); });
  }, [stationId, taskId]);

  useEffect(() => { load(); }, [load]);

  async function handleAssign(userId, override) {
    setBusy(true);
    try {
      let overrideReason;
      if (override) {
        overrideReason = prompt("This candidate fails a hard constraint. Enter a reason to override and assign anyway:");
        if (!overrideReason) { setBusy(false); return; }
      }
      await taApi.manualAssign(stationId, taskId, userId, { override: !!override, overrideReason });
      load(); onChanged?.();
    } catch (err) { alert(`Assignment not permitted: ${err.message}`); } finally { setBusy(false); }
  }

  async function handleCancel() {
    if (!confirm("Cancel this task? This cannot be undone.")) return;
    setBusy(true);
    try {
      await taApi.cancelTask(stationId, taskId, "Cancelled from Task Board");
      onChanged?.(); onClose();
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
  }

  async function handleReallocate() {
    setBusy(true);
    try {
      await taApi.reallocateTask(stationId, taskId, trigger, triggerDetail || undefined);
      setShowReallocate(false);
      load(); onChanged?.();
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
  }

  if (!task) return null;
  const active = (task.assignments || []).find(a => a.status === "ACTIVE");

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="popover-card" style={{ width: 560, maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="card-title" style={{ marginBottom: 4 }}>{task.taskNumber} — {task.taskType}</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10 }}>
          {task.aircraftRegistration || "—"} {task.flightNumber ? `(${task.flightNumber})` : ""} · {task.stand ? `Stand ${task.stand}` : "No stand"} ·{" "}
          {new Date(task.plannedStart).toLocaleString()} → deadline {new Date(task.deadline).toLocaleTimeString()} · Required: {task.requiredCategory || task.requiredRole || "—"}
        </div>

        {active ? (
          <div className="ab green" style={{ marginBottom: 10 }}>
            ✅ Assigned to <strong>{active.userName || active.userId}</strong>
            {active.isOverride && " (via override)"}{active.isManual ? " · manual" : " · auto"}
          </div>
        ) : (
          <div className="ab red" style={{ marginBottom: 10 }}>🔴 Unassigned</div>
        )}

        {active?.explanation && (
          <div className="card" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Why was this person assigned?</div>
            {active.explanation.checklist.map(c => (
              <div key={c.code} style={{ fontSize: 10, display: "flex", gap: 6, padding: "2px 0" }}>
                <span>{c.passed ? "✓" : "✗"}</span><span>{c.label}</span>
              </div>
            ))}
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6 }}>
              {active.explanation.travelTimeMinutes != null && <>Travel time: {active.explanation.travelTimeMinutes} min · </>}
              {active.explanation.workloadAfterPct != null && <>Projected workload: {active.explanation.workloadAfterPct}% · </>}
              {active.explanation.score != null && <>Score: {active.explanation.score}/100</>}
            </div>
          </div>
        )}

        <div className="card-title" style={{ fontSize: 11, marginTop: 10 }}>Eligible Employees</div>
        {!candidates ? <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Loading candidates…</div> : !candidates.isPublished ? (
          <div className="empty-note">No published roster for this date.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {candidates.results.map(r => (
              <div key={r.candidate.userId} className={`alert-card ${r.eligible ? "green" : "amber"}`} style={{ alignItems: "flex-start" }}>
                <span>{r.eligible ? "✓" : "⚠"}</span>
                <div style={{ flex: 1 }}>
                  <div className="alert-card-title">{r.candidate.fullName} <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>({r.candidate.category})</span></div>
                  {!r.eligible && <div className="alert-card-sub">{r.failedReasons.join("; ")}</div>}
                </div>
                {active?.userId !== r.candidate.userId && (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleAssign(r.candidate.userId, !r.eligible)}>
                    {r.eligible ? "Assign" : "Override & Assign"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 7, marginTop: 14, flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowReallocate(s => !s)}>🔁 Reallocate</button>
          {task.status !== "CANCELLED" && <button className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={busy}>🗑 Cancel Task</button>}
        </div>

        {showReallocate && (
          <div className="card" style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>Reallocate — reassess this task only</div>
            <select className="fi" value={trigger} onChange={e => setTrigger(e.target.value)} style={{ marginBottom: 6 }}>
              {TRIGGERS.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
            <input className="fi" placeholder="Detail (optional) — e.g. 'Aircraft delayed 45 min'" value={triggerDetail} onChange={e => setTriggerDetail(e.target.value)} style={{ marginBottom: 6 }} />
            <button className="btn btn-primary btn-sm" onClick={handleReallocate} disabled={busy}>Run Reallocation</button>
          </div>
        )}
      </div>
    </div>
  );
}
