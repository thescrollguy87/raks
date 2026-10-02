// TASK ALLOCATION MODULE — Conflicts (Section 12).
import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../../store/PageHeaderContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import * as taApi from "../../api/taskAllocation.js";

function todayIso() { return new Date().toISOString().slice(0, 10); }
const TYPE_LABEL = {
  EMPLOYEE_OVERLAP: "Employee conflict", QUALIFICATION: "Qualification conflict",
  LOCATION_TRAVEL: "Location conflict", DEADLINE: "Deadline conflict", RESOURCE_SHORTAGE: "Resource shortage",
};

export default function ConflictsPage() {
  const { stationId } = useStation();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  usePageHeader({ title: "Conflicts", subtitle: "Employee, qualification, location, deadline and resource-shortage conflicts" });

  const load = useCallback(() => {
    if (!stationId) return;
    setLoading(true);
    taApi.listConflicts(stationId, { dateFrom, dateTo, resolved: false }).then(setConflicts).finally(() => setLoading(false));
  }, [stationId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  async function handleDetect() {
    setBusy(true);
    try {
      const result = await taApi.detectConflicts(stationId, dateFrom, dateTo);
      alert(`Scanned ${result.tasksScanned} task(s), found ${result.conflictsFound} conflict(s).`);
      load();
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
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
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={handleDetect} disabled={busy}>Re-scan for conflicts</button>
        </div>
      </div>

      {loading ? <div className="card">Loading…</div> : conflicts.length === 0 ? (
        <div className="ab green">✅ No open conflicts in this range.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {conflicts.map(c => (
            <div key={c.id} className={`alert-card ${c.severity === "BLOCKING" ? "red" : "amber"}`}>
              <span>{c.severity === "BLOCKING" ? "🔴" : "⚠"}</span>
              <div>
                <div className="alert-card-title">{TYPE_LABEL[c.conflictType] || c.conflictType}{c.task ? ` — ${c.task.taskNumber}` : ""}</div>
                <div className="alert-card-sub">{c.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
