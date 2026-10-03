// TASK ALLOCATION MODULE — Task Board (Section 14). Its own directory under
// pages/, separate from every existing roster page.
import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../../store/PageHeaderContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import { useAuth } from "../../store/AuthContext.jsx";
import * as taApi from "../../api/taskAllocation.js";
import TaskDetailModal from "./components/TaskDetailModal.jsx";

const STATUS_DOT = {
  ASSIGNED: "🟢", IN_PROGRESS: "🟢", COMPLETED: "🟢",
  BLOCKED: "🟡", READY: "🟡", DRAFT: "🟡",
  UNASSIGNED: "🔴", CANCELLED: "⚪",
};
function todayIso() { return new Date().toISOString().slice(0, 10); }
// A task's own plannedStart is station wall-clock time stamped as UTC (same
// convention as Flight Instance std/sta) — timeZone:"UTC" reads it back
// literally instead of shifting it into the viewer's own timezone.
function fmtTaskTime(d) { return d ? new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "—"; }
// lastUpdated is a genuine `new Date()` capture of when this page last
// fetched — a real instant, correctly shown in the viewer's own timezone.
function fmtLocalTime(d) { return d ? new Date(d).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"; }

export default function TaskBoardPage() {
  const { stationId } = useStation();
  const { hasPermission } = useAuth();
  const [date, setDate] = useState(todayIso());
  const [syncStatus, setSyncStatus] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filters, setFilters] = useState({ status: "", taskType: "", aircraftRegistration: "" });
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const canCreate = hasPermission("task_allocation", "create");
  const canAssign = hasPermission("task_allocation", "assign");

  usePageHeader({ title: "Task Board", subtitle: "Which task should each already-rostered person perform during their shift" });

  const load = useCallback(() => {
    if (!stationId) return;
    setLoading(true);
    Promise.all([
      taApi.getRosterSyncStatus(stationId, date).catch(() => null),
      taApi.getAvailability(stationId, date).catch(() => null),
      taApi.listTasks(stationId, { dateFrom: date, dateTo: date, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).catch(() => []),
    ]).then(([sync, avail, t]) => {
      setSyncStatus(sync); setAvailability(avail); setTasks(t); setLastUpdated(new Date());
    }).finally(() => setLoading(false));
  }, [stationId, date, filters]);

  useEffect(() => { load(); }, [load]);

  // Section 27: auto-refresh on a timer, manual refresh always available —
  // no websocket infra exists in this app yet, so a modest poll interval
  // substitutes rather than leaving the board to go stale silently.
  useEffect(() => {
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  async function handleGenerate() {
    setBusy(true);
    try {
      const result = await taApi.generateTasks(stationId, date);
      alert(`Generated ${result.generated} task(s) from today's flight instances.`);
      load();
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
  }

  async function handleAutoAllocate() {
    setBusy(true);
    try {
      const run = await taApi.runAutoAllocation(stationId, date, date);
      alert(`Tasks processed: ${run.tasksProcessed}\nTasks assigned: ${run.tasksAssigned}\nUnassigned: ${run.tasksUnassigned}\nConflicts: ${run.conflictsCount}\nWarnings: ${run.warningsCount}`);
      load();
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
  }

  return (
    <div>
      {syncStatus && (
        <div className={`ab ${syncStatus.isPublished ? "green" : "amber"}`} style={{ marginBottom: 10 }}>
          Roster Date: <strong>{date}</strong> · Roster Status: <strong>{syncStatus.isPublished ? "Published" : "Draft"}</strong>
          {lastUpdated && <> · Last Sync: <strong>{fmtLocalTime(lastUpdated)}</strong></>}
        </div>
      )}
      {!syncStatus && !loading && (
        <div className="ab red" style={{ marginBottom: 10 }}>No published roster exists for {date} — Task Allocation has no staff source until Rostering publishes one.</div>
      )}

      {availability && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 14 }}>
          {Object.entries(availability.byCategory).map(([cat, n]) => (
            <div className="stat-card sky" key={cat}>
              <div className="stat-label">{cat}</div>
              <div className="stat-value">{n}</div>
              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>available</div>
            </div>
          ))}
          <div className="stat-card neutral">
            <div className="stat-label">Total</div>
            <div className="stat-value">{availability.totalAvailable}</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>available</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="date" className="fi" value={date} onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
          <select className="fi" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={{ width: 160 }}>
            <option value="">All statuses</option>
            {["DRAFT", "READY", "UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "BLOCKED"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="fi" placeholder="Task type…" value={filters.taskType} onChange={e => setFilters(f => ({ ...f, taskType: e.target.value }))} style={{ width: 140 }} />
          <input className="fi" placeholder="Aircraft reg…" value={filters.aircraftRegistration} onChange={e => setFilters(f => ({ ...f, aircraftRegistration: e.target.value }))} style={{ width: 140 }} />
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>🔄 Refresh</button>
          <div style={{ flex: 1 }} />
          {canCreate && <button className="btn btn-ghost" onClick={handleGenerate} disabled={busy}>⚙ Generate Tasks</button>}
          {canAssign && <button className="btn btn-primary" onClick={handleAutoAllocate} disabled={busy}>✨ Run Auto Allocation</button>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">📋 Task Board — {date}</div>
        {loading ? <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Loading…</div> : tasks.length === 0 ? (
          <div className="empty-note">No tasks for this date. Generate from flight instances, or create one manually.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="dc-table">
              <thead>
                <tr>
                  <th>Time</th><th>Aircraft</th><th>Task</th><th>Required</th><th>Assigned</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => {
                  const active = (t.assignments || []).find(a => a.status === "ACTIVE");
                  return (
                    <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setSelectedTaskId(t.id)}>
                      <td>{fmtTaskTime(t.plannedStart)}</td>
                      <td>{t.aircraftRegistration || "—"}{t.flightNumber ? ` (${t.flightNumber})` : ""}</td>
                      <td>{t.taskType}{t.stand ? ` · Stand ${t.stand}` : ""}</td>
                      <td>{t.requiredCategory || t.requiredRole || "—"}</td>
                      <td>{active ? active.userName || active.userId : "—"}</td>
                      <td>{STATUS_DOT[t.status] || ""} {t.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedTaskId && (
        <TaskDetailModal
          stationId={stationId} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)}
          onChanged={() => { load(); }}
        />
      )}
    </div>
  );
}
