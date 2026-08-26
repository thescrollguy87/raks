import { useState, useEffect, useMemo } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as rosterApi from "../api/roster.js";

function todayISO() { return new Date().toISOString().slice(0, 10); }
function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthKeyOf(iso) { return iso.slice(0, 7); }

const SHIFTS = [
  { key: "M", label: "Morning" },
  { key: "A", label: "Afternoon" },
  { key: "N", label: "Night" },
];

// Combines the prototype's "Rolling 7-Day" and "Daily Coverage" screens
// into one view with a window-size toggle — both were reading the same
// underlying data (who's on which shift, which days), just displayed at
// different granularity.
export default function CoveragePage() {
  const { stationId } = useStation();
  const [startDate, setStartDate] = useState(todayISO());
  const [windowSize, setWindowSize] = useState(7); // 1 = Daily Coverage, 7 = Rolling 7-Day
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState("");

  usePageHeader({ title: windowSize === 1 ? "Daily Coverage" : "Rolling 7-Day Coverage", subtitle: "AMD Line Maintenance" });

  useEffect(() => {
    if (!stationId) return;
    rosterApi.getRosterGrid(stationId, monthKeyOf(startDate))
      .then(grid => setStaff(grid.staff))
      .catch(err => setError(err.message));
  }, [stationId, startDate]);

  const days = useMemo(() => Array.from({ length: windowSize }, (_, i) => addDays(startDate, i)), [startDate, windowSize]);

  const coverage = useMemo(() => {
    if (!staff) return null;
    return days.map(dateStr => {
      const byShift = {};
      for (const sh of SHIFTS) {
        const onShift = staff.filter(s => s.shiftAssignments.some(sa =>
          new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr && sa.shiftDef.code === sh.key
        ));
        byShift[sh.key] = onShift;
      }
      return { date: dateStr, byShift };
    });
  }, [staff, days]);

  if (error) return <div className="ab red">{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input className="fi" style={{ width: 150 }} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <button className="btn btn-ghost" onClick={() => setStartDate(todayISO())}>Today</button>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn btn-ghost" style={windowSize === 1 ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined} onClick={() => setWindowSize(1)}>Daily</button>
          <button className="btn btn-ghost" style={windowSize === 7 ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined} onClick={() => setWindowSize(7)}>7-Day Rolling</button>
        </div>
      </div>

      {!coverage ? <div className="card">Loading…</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {coverage.map(day => (
            <div className="card" key={day.date}>
              <div className="card-title">{new Date(day.date + "T00:00:00.000Z").toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" })}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 8 }}>
                {SHIFTS.map(sh => {
                  const onShift = day.byShift[sh.key];
                  const hasB1 = onShift.some(s => s.category === "B1");
                  const hasB2 = onShift.some(s => s.category === "B2");
                  const gap = !hasB1 || (sh.key === "N" && !hasB2);
                  return (
                    <div key={sh.key} style={{ border: `1px solid ${gap ? "var(--rp-red)" : "var(--border)"}`, borderRadius: 7, padding: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", marginBottom: 4 }}>
                        {sh.label} <span className="tag" style={{ marginLeft: 4 }}>{onShift.length}</span>
                        {gap && <span className="tag" style={{ marginLeft: 4, background: "rgba(229,57,53,.18)", color: "var(--rp-red)" }}>⚠ Gap</span>}
                      </div>
                      {onShift.length === 0 ? (
                        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No staff assigned</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {onShift.map(s => (
                            <div key={s.id} style={{ fontSize: 10, display: "flex", justifyContent: "space-between" }}>
                              <span>{s.fullName.split("(")[0].trim()}</span>
                              <span className={`cat-tag cat-${s.category || "NCS"}`}>{s.category || "NCS"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
