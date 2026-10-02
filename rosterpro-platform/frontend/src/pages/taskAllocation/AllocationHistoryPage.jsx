// TASK ALLOCATION MODULE — Allocation History (Section 22) + What-If
// Simulation (Section 21), kept together since both read/write the same
// AllocationRun/AllocationEvent audit trail.
import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../../store/PageHeaderContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import { useAuth } from "../../store/AuthContext.jsx";
import * as taApi from "../../api/taskAllocation.js";

function todayIso() { return new Date().toISOString().slice(0, 10); }
const EVENT_LABEL = { ASSIGNED: "Assigned", REASSIGNED: "Reassigned", UNASSIGNED: "Unassigned", OVERRIDE: "Override", CANCELLED: "Cancelled", STATUS_CHANGED: "Status changed" };

export default function AllocationHistoryPage() {
  const { stationId } = useStation();
  const { hasPermission } = useAuth();
  const [events, setEvents] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("history");

  const [whatIfUserId, setWhatIfUserId] = useState("");
  const [whatIfDate, setWhatIfDate] = useState(todayIso());
  const [whatIfReason, setWhatIfReason] = useState("");
  const [whatIfResult, setWhatIfResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const canReallocate = hasPermission("task_allocation", "reallocate");

  usePageHeader({ title: "Allocation History", subtitle: "Every automatic/manual assignment, reassignment and override — plus What-If simulation" });

  const load = useCallback(() => {
    if (!stationId) return;
    setLoading(true);
    Promise.all([taApi.listHistory(stationId, {}), taApi.listRuns(stationId)])
      .then(([h, r]) => { setEvents(h); setRuns(r); })
      .finally(() => setLoading(false));
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  async function handleWhatIf() {
    if (!whatIfUserId) { alert("Enter a staff member's user ID (from Staff Registry) to simulate their unavailability."); return; }
    setBusy(true);
    try {
      const result = await taApi.runWhatIf(stationId, whatIfUserId, whatIfDate, whatIfReason);
      setWhatIfResult(result);
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
  }
  async function handleCommit() {
    if (!whatIfResult) return;
    if (!confirm(`Commit ${whatIfResult.proposals.filter(p => p.proposedUserId).length} reassignment(s)? This changes real task assignments.`)) return;
    setBusy(true);
    try {
      const result = await taApi.commitWhatIf(stationId, whatIfResult.runId);
      alert(`Committed ${result.committed} reassignment(s).`);
      setWhatIfResult(null); load();
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button className={`view-toggle-btn ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>Event History</button>
        <button className={`view-toggle-btn ${tab === "runs" ? "active" : ""}`} onClick={() => setTab("runs")}>Allocation Runs</button>
        {canReallocate && <button className={`view-toggle-btn ${tab === "whatif" ? "active" : ""}`} onClick={() => setTab("whatif")}>What-If Simulation</button>}
      </div>

      {tab === "history" && (
        <div className="card">
          {loading ? "Loading…" : events.length === 0 ? <div className="empty-note">No allocation events yet.</div> : (
            <div className="timeline">
              {events.map(e => (
                <div className="tl-item" key={e.id}>
                  <div className={`tl-dot ${e.eventType === "OVERRIDE" ? "alert" : "change"}`} />
                  <div className="tl-content">
                    <div className="tl-hdr">
                      <span className="tl-user">{EVENT_LABEL[e.eventType] || e.eventType}</span>
                      <span className="tl-ts">{new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="tl-action">
                      {e.previousUserId && <>Previous: {e.previousUserName || e.previousUserId} → </>}
                      {e.newUserId && <>New: {e.newUserName || e.newUserId}</>}
                      {e.reason && <> · Reason: {e.reason}</>}
                      {e.trigger && e.trigger !== "MANUAL" && <> · Trigger: {e.trigger.replace(/_/g, " ")}</>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "runs" && (
        <div className="card">
          <table className="dc-table">
            <thead><tr><th>Started</th><th>Type</th><th>Trigger</th><th>Processed</th><th>Assigned</th><th>Unassigned</th><th>Conflicts</th></tr></thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td>{r.runType}</td>
                  <td>{r.trigger?.replace(/_/g, " ")}</td>
                  <td>{r.tasksProcessed}</td>
                  <td>{r.tasksAssigned}</td>
                  <td>{r.tasksUnassigned}</td>
                  <td>{r.conflictsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "whatif" && (
        <div className="card">
          <div className="card-title">What if a staff member becomes unavailable?</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
            Simulates the impact only — nothing is changed until you review the proposals below and explicitly commit.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input className="fi" placeholder="Staff user ID" value={whatIfUserId} onChange={e => setWhatIfUserId(e.target.value)} style={{ width: 280 }} />
            <input type="date" className="fi" value={whatIfDate} onChange={e => setWhatIfDate(e.target.value)} style={{ width: 160 }} />
            <input className="fi" placeholder="Reason (optional)" value={whatIfReason} onChange={e => setWhatIfReason(e.target.value)} style={{ width: 220 }} />
            <button className="btn btn-primary btn-sm" onClick={handleWhatIf} disabled={busy}>Simulate</button>
          </div>
          {whatIfResult && (
            <div>
              <div style={{ fontSize: 11, marginBottom: 8 }}>Affected tasks: <strong>{whatIfResult.affectedTaskCount}</strong></div>
              {whatIfResult.proposals.map(p => (
                <div key={p.taskId} style={{ fontSize: 11, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                  {p.taskNumber}: {p.previousUserName || p.previousUserId} → {p.proposedUserId ? <strong>{p.proposedUserName || p.proposedUserId}</strong> : <span style={{ color: "var(--rp-red)" }}>Unassigned ({p.reason})</span>}
                </div>
              ))}
              <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={handleCommit} disabled={busy}>✅ Confirm & Commit</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
