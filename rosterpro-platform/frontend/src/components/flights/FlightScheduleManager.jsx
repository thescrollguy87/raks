import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as flightScheduleApi from "../../api/flightSchedule.js";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function KpiTile({ icon, label, value, sub }) {
  return (
    <div className="stat-card sky">
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Turn Report / Charter import + the full daily flight schedule view — the
// single shared implementation used by BOTH the Auto-Roster Generator's
// Flight Schedule tab and the standalone Flight Schedule page in the left
// sidebar, so there is exactly one import feature, not two copies that can
// drift apart. `onDayClick`, when passed, replaces the plain expand/
// collapse row click with the caller's own handler (used by the sidebar
// page to open that day's Manpower Allocation panel instead).
export default function FlightScheduleManager({ stationId, monthKey, onMonthKeyChange, onDayClick, expandedDay, renderDayExtra }) {
  const [internalMonthKey, setInternalMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [schedule, setSchedule] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [internalExpandedDay, setInternalExpandedDay] = useState(null);
  const [expandAll, setExpandAll] = useState(false);
  const [workloadView, setWorkloadView] = useState("month"); // "month" | "daily-avg"
  const fileInputRef = useRef(null);

  const effectiveMonthKey = monthKey ?? internalMonthKey;
  const setMonthKey = onMonthKeyChange ?? setInternalMonthKey;
  const effectiveExpandedDay = expandedDay !== undefined ? expandedDay : internalExpandedDay;
  const setExpandedDayRaw = onDayClick ?? setInternalExpandedDay;

  const [year, month] = effectiveMonthKey.split("-").map(Number);
  const monthLabel = `${MONTH_LONG[month - 1]} ${year}`;

  const load = useCallback(() => {
    if (!stationId) return;
    flightScheduleApi.getFlightSchedule(stationId, year, month).then(setSchedule).catch(err => setError(err.message));
  }, [stationId, year, month]);
  useEffect(load, [load]);
  useEffect(() => { if (expandedDay === undefined) { setInternalExpandedDay(null); setExpandAll(false); } }, [effectiveMonthKey, expandedDay]);

  function toggleDay(d) {
    if (expandAll) setExpandAll(false);
    setExpandedDayRaw(effectiveExpandedDay === d && !expandAll ? null : d);
  }

  async function runImport(chosenFile) {
    const f = chosenFile || file;
    if (!f) { setError("Choose a Turn Report / Charter Excel file (.xlsx) first"); return; }
    setBusy(true);
    setError("");
    setImportResult(null);
    try {
      const result = await flightScheduleApi.importFlightSchedule(stationId, year, month, f);
      setImportResult(result);
      setFile(null);
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) { setFile(dropped); runImport(dropped); }
  }

  // Real per-weekday average movement count for the month — grouped from
  // the exact same day-by-day flight counts the "This Month" tiles use,
  // just averaged across however many of each weekday actually occurred.
  const weekdayAverages = useMemo(() => {
    if (!schedule?.imported) return null;
    const sums = Array(7).fill(0);
    const counts = Array(7).fill(0);
    for (let d = 1; d <= schedule.daysInMonth; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      sums[dow] += (schedule.byDay[d] || []).length;
      counts[dow]++;
    }
    return WEEKDAY_SHORT.map((label, i) => ({ label, avg: counts[i] > 0 ? Math.round((sums[i] / counts[i]) * 10) / 10 : 0 }));
  }, [schedule, year, month]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="card">
          <div className="card-title">📄 Flight Schedule Import (Turn Report)</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
            Upload the monthly Turn Report Excel export (Inbound/Outbound sheet, plus an optional Charter Flights sheet). Re-importing the same month replaces its previous data.
          </div>
          {error && <div className="ab red">{error}</div>}

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "var(--cyan)" : "var(--border)"}`, borderRadius: 10, padding: "20px 12px", textAlign: "center",
              cursor: "pointer", background: dragOver ? "rgba(0,198,255,.06)" : "var(--navy-lite)", marginBottom: 10, transition: "border-color .15s,background .15s",
            }}
          >
            <div style={{ fontSize: 22 }}>☁️</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--cyan)", marginTop: 4 }}>
              {file ? file.name : "Drag & drop your file here"}
            </div>
            {!file && <div style={{ fontSize: 9, color: "var(--text-dim)" }}>or click to choose file</div>}
            <div style={{ fontSize: 8, color: "var(--text-dim)", marginTop: 6 }}>Supported formats: .xlsx, .xls</div>
            <input
              ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="fg2" style={{ marginBottom: 10 }}>
            <div className="fg"><label className="fl">Target Month</label><input className="fi" type="month" value={effectiveMonthKey} onChange={e => { setMonthKey(e.target.value); setImportResult(null); }} /></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => runImport()} disabled={busy}>{busy ? "Importing…" : "⬆ Import Turn Report"}</button>
          {importResult && <div className="ab green" style={{ marginTop: 10 }}>✅ Imported: {importResult.turnRowCount} turn-report row(s), {importResult.charterRowCount} charter row(s)</div>}
        </div>

        <div className="card">
          <div className="card-title">📘 Need Help?</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.6 }}>
            Use the exported Turn Report from Operations. Include both Inbound and Outbound sheets — the importer reads the "Inbound/Outbound" turn sheet and, if present, a "Charter Flights" sheet, and expands each row's Effective Date / Discontinue Date / Days of Week into the actual calendar dates it operates within your selected target month.
          </div>
        </div>
      </div>

      {schedule?.imported && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>📊 Flight Workload — Derived From Import</span>
            <div className="view-toggle">
              <button className={`view-toggle-btn ${workloadView === "month" ? "active" : ""}`} onClick={() => setWorkloadView("month")}>This Month</button>
              <button className={`view-toggle-btn ${workloadView === "daily-avg" ? "active" : ""}`} onClick={() => setWorkloadView("daily-avg")}>Daily Avg</button>
            </div>
          </div>
          {workloadView === "month" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 10 }}>
              <KpiTile icon="🗓" label="Operating Days" value={`${schedule.summary.operatingDays} / ${schedule.summary.daysInMonth}`} />
              <KpiTile icon="✈️" label="Total Movements" value={schedule.summary.totalMovements} />
              <KpiTile icon="👥" label="Avg Daily Movements" value={schedule.summary.avgDailyMovements} />
              <KpiTile icon="📈" label="Peak Daily Movements" value={schedule.summary.peakDailyMovements} sub={schedule.summary.peakDate || ""} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))", gap: 8, marginTop: 10 }}>
              {weekdayAverages.map(w => (
                <div key={w.label} className="stat-card neutral" style={{ textAlign: "center", padding: "8px 4px" }}>
                  <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{w.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{w.avg}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 10 }}>
            Source: {schedule.summary.turnRowCount} turn-report row(s), {schedule.summary.charterRowCount} charter row(s) — expanded against Effective/Discontinue dates and Days of the Week for the selected month. "Movements" = one takeoff or landing (a turn-report row contributes up to 2 per operating day: inbound arrival + outbound departure). Daily Avg shows the average movements for each weekday across every occurrence of that weekday this month.
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>🛫 Full Daily Flight Schedule — {monthLabel}</span>
          {schedule?.imported && (
            <button className="btn btn-ghost btn-sm" onClick={() => setExpandAll(v => !v)}>{expandAll ? "▲ Collapse All" : "▼ Expand All"}</button>
          )}
        </div>
        {!schedule ? <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Loading…</div> : !schedule.imported ? (
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No flight schedule imported for this month yet.</div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8 }}>Click any day to expand its full flight list. Every day of the month is listed, including days with zero flights.</div>
            <div className="wl-scroll" style={{ maxHeight: 620 }}>
              {Array.from({ length: schedule.daysInMonth }, (_, i) => i + 1).map(d => {
                const weekday = WEEKDAY_SHORT[new Date(year, month - 1, d).getDay()];
                const flights = schedule.byDay[d] || [];
                const isOpen = expandAll || effectiveExpandedDay === d;
                return (
                  <div key={d} style={{ borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", cursor: "pointer" }} onClick={() => toggleDay(d)}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--cyan)" }}>{isOpen ? "▼" : "▶"} Day {d} ({weekday}) — {new Date(year, month - 1, d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</span>
                      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{flights.length} flight(s)</span>
                    </div>
                    {isOpen && (
                      <div style={{ paddingLeft: 4, paddingBottom: 6 }}>
                        {flights.length === 0 ? <div style={{ fontSize: 9, color: "var(--text-dim)", padding: "4px 12px" }}>No flights this day.</div> : (
                          <div style={{ overflowX: "auto" }}>
                            <table className="dc-table">
                              <thead>
                                <tr>
                                  <th style={{ textAlign: "left" }}>#</th>
                                  <th style={{ textAlign: "left" }}>Flight Ref</th>
                                  <th style={{ textAlign: "left" }}>Route</th>
                                  <th>STA</th>
                                  <th>STD</th>
                                  <th>Ground Time</th>
                                  <th>Type</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {flights.map((f, i) => (
                                  <tr key={i}>
                                    <td style={{ textAlign: "left" }}>{i + 1}</td>
                                    <td style={{ textAlign: "left", fontWeight: 700 }}>{f.type === "Turn" ? "🔄" : "🛩"} {f.flightRef}</td>
                                    <td style={{ textAlign: "left" }}>{f.route}</td>
                                    <td>{f.arr !== "-" ? f.arr : "—"}</td>
                                    <td>{f.dep !== "-" ? f.dep : "—"}</td>
                                    <td>{f.ground !== "-" ? f.ground : "—"}</td>
                                    <td><span className="tag">{f.type}</span></td>
                                    <td><span className="metric-badge green">Scheduled</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {!expandAll && renderDayExtra && renderDayExtra(d, year, month)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
