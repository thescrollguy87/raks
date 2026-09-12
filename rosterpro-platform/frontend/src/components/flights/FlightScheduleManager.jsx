import { useState, useEffect, useCallback } from "react";
import * as flightScheduleApi from "../../api/flightSchedule.js";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function HowToUse({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ab" style={{ background: "rgba(0,198,255,.07)", borderColor: "var(--cyan)", cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--cyan)" }}>{open ? "▼" : "▶"} ⓘ How to use this (click to expand)</div>
      {open && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.5 }}>{children}</div>}
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
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [internalExpandedDay, setInternalExpandedDay] = useState(null);

  const effectiveMonthKey = monthKey ?? internalMonthKey;
  const setMonthKey = onMonthKeyChange ?? setInternalMonthKey;
  const effectiveExpandedDay = expandedDay !== undefined ? expandedDay : internalExpandedDay;
  const setExpandedDay = onDayClick ?? setInternalExpandedDay;

  const [year, month] = effectiveMonthKey.split("-").map(Number);
  const monthLabel = `${MONTH_LONG[month - 1]} ${year}`;

  const load = useCallback(() => {
    if (!stationId) return;
    flightScheduleApi.getFlightSchedule(stationId, year, month).then(setSchedule).catch(err => setError(err.message));
  }, [stationId, year, month]);
  useEffect(load, [load]);
  useEffect(() => { if (expandedDay === undefined) setInternalExpandedDay(null); }, [effectiveMonthKey, expandedDay]);

  async function doImport() {
    if (!file) { setError("Choose a Turn Report / Charter Excel file (.xlsx) first"); return; }
    setBusy(true);
    setError("");
    setImportResult(null);
    try {
      const result = await flightScheduleApi.importFlightSchedule(stationId, year, month, file);
      setImportResult(result);
      setFile(null);
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <HowToUse>
        Import your Turn Report Excel exactly as exported — no reformatting needed. The importer reads the "Inbound/Outbound" turn sheet and, if present, a "Charter Flights" sheet and expands each row's Effective Date / Discontinue Date / Days of Week into the actual calendar dates it operates within your selected target month.
      </HowToUse>

      <div className="card">
        <div className="card-title">✈ Flight Schedule Import (Turn Report)</div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
          Upload the monthly Turn Report Excel export (Inbound/Outbound sheet, plus an optional Charter Flights sheet). Re-importing the same month replaces its previous data.
        </div>
        {error && <div className="ab red">{error}</div>}
        <div className="fg2" style={{ marginBottom: 10 }}>
          <div className="fg"><label className="fl">Target Month</label><input className="fi" type="month" value={effectiveMonthKey} onChange={e => { setMonthKey(e.target.value); setImportResult(null); }} /></div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={doImport} disabled={busy}>{busy ? "Importing…" : "⬆ Import Turn Report"}</button>
        <input className="fi" type="file" accept=".xlsx" style={{ marginTop: 8 }} onChange={e => setFile(e.target.files?.[0] || null)} />
        {importResult && <div className="ab green" style={{ marginTop: 10 }}>✅ Imported: {importResult.turnRowCount} turn-report row(s), {importResult.charterRowCount} charter row(s)</div>}
      </div>

      {schedule?.imported && (
        <div className="card">
          <div className="card-title">📊 Flight Workload — Derived From Import</div>
          <div className="manpower-grid">
            <div className="mp-card"><div className="mp-shift" style={{ fontSize: 10, color: "var(--text-dim)" }}>Operating Days</div><div className="mp-total" style={{ fontSize: 20, fontWeight: 800 }}>{schedule.summary.operatingDays}<span style={{ fontSize: 12, color: "var(--text-dim)" }}> / {schedule.summary.daysInMonth}</span></div></div>
            <div className="mp-card"><div className="mp-shift" style={{ fontSize: 10, color: "var(--text-dim)" }}>Total Movements</div><div className="mp-total" style={{ fontSize: 20, fontWeight: 800 }}>{schedule.summary.totalMovements}</div></div>
            <div className="mp-card"><div className="mp-shift" style={{ fontSize: 10, color: "var(--text-dim)" }}>Avg Daily Movements</div><div className="mp-total" style={{ fontSize: 20, fontWeight: 800 }}>{schedule.summary.avgDailyMovements}</div></div>
            <div className="mp-card"><div className="mp-shift" style={{ fontSize: 10, color: "var(--text-dim)" }}>Peak Daily Movements</div><div className="mp-total" style={{ fontSize: 20, fontWeight: 800 }}>{schedule.summary.peakDailyMovements}</div><div className="mp-breakdown" style={{ fontSize: 9, color: "var(--text-dim)" }}>{schedule.summary.peakDate || ""}</div></div>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 8 }}>
            Source: {schedule.summary.turnRowCount} turn-report row(s), {schedule.summary.charterRowCount} charter row(s) — expanded against Effective/Discontinue dates and Days of the Week for the selected month. "Movements" = one takeoff or landing (a turn-report row contributes up to 2 per operating day: inbound arrival + outbound departure).
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">🛫 Full Daily Flight Schedule — {monthLabel}</div>
        {!schedule ? <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Loading…</div> : !schedule.imported ? (
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No flight schedule imported for this month yet.</div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8 }}>Click any day to expand its full flight list. Every day of the month is listed, including days with zero flights.</div>
            <div className="wl-scroll" style={{ maxHeight: 560 }}>
              {Array.from({ length: schedule.daysInMonth }, (_, i) => i + 1).map(d => {
                const weekday = WEEKDAY_SHORT[new Date(year, month - 1, d).getDay()];
                const flights = schedule.byDay[d] || [];
                const isOpen = effectiveExpandedDay === d;
                return (
                  <div key={d} style={{ borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", cursor: "pointer" }} onClick={() => setExpandedDay(isOpen ? null : d)}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--cyan)" }}>{isOpen ? "▼" : "▶"} Day {d} ({weekday})</span>
                      <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{flights.length} flight(s)</span>
                    </div>
                    {isOpen && (
                      <div style={{ paddingLeft: 16, paddingBottom: 6 }}>
                        {flights.length === 0 ? <div style={{ fontSize: 9, color: "var(--text-dim)" }}>No flights this day.</div> : flights.map((f, i) => (
                          <div key={i} style={{ fontSize: 9, color: "var(--text-dim)", display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                            <span>{f.type === "Turn" ? "🔄" : "🛩"} {f.flightRef} <span style={{ color: "var(--text-dim)" }}>{f.route}</span></span>
                            <span>{f.arr !== "-" ? `Arr ${f.arr}` : ""} {f.dep !== "-" ? `Dep ${f.dep}` : ""} {f.ground !== "-" ? `GT ${f.ground}` : ""}</span>
                          </div>
                        ))}
                        {renderDayExtra && renderDayExtra(d, year, month)}
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
