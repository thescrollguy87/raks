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

function daysInMonthOf(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Net hours for one shift: end - start (crossing midnight if end < start),
// minus the break. Shifts with no real time (O/L placeholders) are 0.
function shiftNetHours(def) {
  if (!def?.startTime || !def?.endTime) return 0;
  const [sh, sm] = def.startTime.split(":").map(Number);
  const [eh, em] = def.endTime.split(":").map(Number);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60; // overnight shift
  return Math.max(0, minutes - (def.breakMin || 0)) / 60;
}

// DGCA rolling-7-day cap: 48h; 42h is the warning threshold before that.
function hoursToneClass(hours) {
  if (hours > 48) return "r-over";
  if (hours > 42) return "r-warn";
  return "r-ok";
}

// Combines the prototype's "Rolling 7-Day" and "Daily Coverage" screens
// into one view with a window-size toggle — both were reading the same
// underlying data (who's on which shift, which days), just displayed at
// different granularity.
export default function CoveragePage() {
  const { stationId } = useStation();
  const [startDate, setStartDate] = useState(todayISO());
  const [windowSize, setWindowSize] = useState(7); // 1 = Daily Coverage, 7 = Rolling 7-Day
  const [showHours, setShowHours] = useState(false); // Rolling 7-Day HOURS table (DGCA fatigue view), separate from the who's-on-shift views above
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState("");

  usePageHeader({
    title: showHours ? "Rolling 7-Day Hours" : windowSize === 1 ? "Daily Coverage" : "Rolling 7-Day Coverage",
    subtitle: "AMD Line Maintenance",
  });

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

  // Rolling 7-day HOURS per staff, for every day of the visible month — a
  // fatigue/compliance view (DGCA caps duty at 48h in any trailing 7-day
  // window; 42h is the warning line) distinct from the "who's on which
  // shift" views above, which don't answer "is anyone about to breach
  // their hours cap."
  const monthKey = monthKeyOf(startDate);
  const hoursTable = useMemo(() => {
    if (!showHours || !staff) return null;
    const nDays = daysInMonthOf(monthKey);
    return staff.map(s => {
      const dailyHours = new Array(nDays).fill(0);
      for (const sa of s.shiftAssignments) {
        const day = new Date(sa.shiftDate).getUTCDate();
        if (day >= 1 && day <= nDays) dailyHours[day - 1] = shiftNetHours(sa.shiftDef);
      }
      const rolling = dailyHours.map((_, i) => {
        let sum = 0;
        for (let j = Math.max(0, i - 6); j <= i; j++) sum += dailyHours[j];
        return sum;
      });
      return { id: s.id, fullName: s.fullName.split("(")[0].trim(), category: s.category, rolling };
    });
  }, [showHours, staff, monthKey]);

  if (error) return <div className="ab red">{error}</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input className="fi" style={{ width: 150 }} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <button className="btn btn-ghost" onClick={() => setStartDate(todayISO())}>Today</button>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="btn btn-ghost" style={!showHours && windowSize === 1 ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined} onClick={() => { setShowHours(false); setWindowSize(1); }}>Daily</button>
          <button className="btn btn-ghost" style={!showHours && windowSize === 7 ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined} onClick={() => { setShowHours(false); setWindowSize(7); }}>7-Day Rolling</button>
          <button className="btn btn-ghost" style={showHours ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined} onClick={() => setShowHours(true)}>Rolling Hours</button>
        </div>
      </div>

      {showHours ? (
        <div className="ab amber" style={{ marginBottom: 10 }}>
          ⚠ Each cell = hours for that day + up to 6 preceding days. DGCA cap: 48h per rolling 7-day window. Amber &gt;42h warning · Red &gt;48h violation.
        </div>
      ) : null}

      {showHours ? (
        !hoursTable ? <div className="card">Loading…</div> : (
          <div className="card">
            <div className="card-title">🔄 Rolling 7-Day Hours — {monthKey}</div>
            <div className="rolling-wrap">
              <table className="rolling-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Staff</th>
                    {Array.from({ length: daysInMonthOf(monthKey) }, (_, i) => <th key={i}>{i + 1}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {hoursTable.map(row => (
                    <tr key={row.id}>
                      <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>{row.fullName}</td>
                      {row.rolling.map((h, i) => (
                        <td key={i}><span className={hoursToneClass(h)} style={{ padding: "1px 4px", borderRadius: 4 }}>{h.toFixed(0)}</span></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : !coverage ? <div className="card">Loading…</div> : (
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
