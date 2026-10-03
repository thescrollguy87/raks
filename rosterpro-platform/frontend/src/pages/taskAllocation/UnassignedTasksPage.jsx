// TASK ALLOCATION MODULE — Unassigned Tasks (Section 15).
import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../../store/PageHeaderContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import * as taApi from "../../api/taskAllocation.js";
import TaskDetailModal from "./components/TaskDetailModal.jsx";

function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function UnassignedTasksPage() {
  const { stationId } = useStation();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [tasks, setTasks] = useState([]);
  const [explain, setExplain] = useState({}); // taskId -> explain result
  const [loading, setLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  usePageHeader({ title: "Unassigned Tasks", subtitle: "Tasks with no eligible resource — never auto-resolved by changing the roster" });

  const load = useCallback(() => {
    if (!stationId) return;
    setLoading(true);
    taApi.listUnassigned(stationId, dateFrom, dateTo).then(setTasks).finally(() => setLoading(false));
  }, [stationId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  async function toggleExplain(taskId) {
    if (explain[taskId]) { setExplain(e => { const n = { ...e }; delete n[taskId]; return n; }); return; }
    const result = await taApi.explainUnassigned(stationId, taskId).catch(() => null);
    setExplain(e => ({ ...e, [taskId]: result }));
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 11 }}>From</label>
          <input type="date" className="fi" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ width: 150 }} />
          <label style={{ fontSize: 11 }}>To</label>
          <input type="date" className="fi" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ width: 150 }} />
          <button className="btn btn-ghost btn-sm" onClick={load}>🔄 Refresh</button>
        </div>
      </div>

      {loading ? <div className="card">Loading…</div> : tasks.length === 0 ? (
        <div className="ab green">✅ No unassigned tasks in this range.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tasks.map(t => (
            <div className="card" key={t.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>🔴 TASK UNASSIGNED — {t.taskNumber}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                    Aircraft: {t.aircraftRegistration || "—"} · Task: {t.taskType} · Required: {t.requiredCategory || t.requiredRole || "—"}<br />
                    {/* station wall-clock stamped as UTC — timeZone:"UTC" reads it back literally, not shifted to the viewer's own timezone */}
                    Start: {new Date(t.plannedStart).toLocaleString(undefined, { timeZone: "UTC" })} · Deadline: {new Date(t.deadline).toLocaleTimeString(undefined, { timeZone: "UTC" })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleExplain(t.id)}>{explain[t.id] ? "Hide reason" : "Why?"}</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setSelectedTaskId(t.id)}>Assign manually</button>
                </div>
              </div>
              {explain[t.id] && (
                <div style={{ marginTop: 8, fontSize: 10 }}>
                  <div style={{ color: "var(--text-dim)", marginBottom: 4 }}>
                    {explain[t.id].isPublished ? `No eligible resource available (${explain[t.id].eligibleCount} of ${explain[t.id].candidates.length} rostered staff eligible).` : "No published roster exists for this date."}
                  </div>
                  {explain[t.id].candidates.map(c => (
                    <div key={c.userId} style={{ padding: "2px 0" }}>
                      {c.eligible ? "✓" : "✗"} {c.fullName}{!c.eligible && c.failedReasons.length ? ` — ${c.failedReasons.join("; ")}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedTaskId && (
        <TaskDetailModal stationId={stationId} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} onChanged={load} />
      )}
    </div>
  );
}
