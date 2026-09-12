import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as departureAllocationApi from "../api/departureAllocation.js";
import FlightScheduleManager from "../components/flights/FlightScheduleManager.jsx";

const SHIFT_LABEL = { M: "Morning", A: "Afternoon", N: "Night" };
const UNFILLED_REASON_LABEL = {
  no_one_rostered: "nobody on this shift's roster in that category",
  all_busy_with_clash: "everyone eligible is already committed to another departure clashing within the configured window",
};

// One departure row: shows the current releaser (B1 or CM — either
// qualifies to give a departure) + support (NCS), each editable via a
// dropdown that calls the manual-assign endpoint directly on change —
// auto-allocate fills the day in one click, but every slot stays a plain
// dropdown a planner can override by hand at any time. Options are
// EXACTLY who the backend resolved as on the real shift roster covering
// this departure's time (dep.eligibleReleasers/eligibleSupport) — never
// the whole station's staff list — with the currently-assigned person
// always kept visible even if a later roster change dropped them from
// that pool, so the dropdown never silently blanks out a real pick.
function DepartureRow({ dep, year, month, day, onChanged, busy, setBusy }) {
  const releaserOptions = dep.releaser && !dep.eligibleReleasers.some(s => s.id === dep.releaser.id)
    ? [...dep.eligibleReleasers, { ...dep.releaser }] : dep.eligibleReleasers;
  const supportOptions = dep.support && !dep.eligibleSupport.some(s => s.id === dep.support.id)
    ? [...dep.eligibleSupport, { ...dep.support }] : dep.eligibleSupport;
  const releaserValue = dep.releaser ? `${dep.releaser.category}:${dep.releaser.id}` : "";

  async function setReleaser(value) {
    setBusy(true);
    try {
      const [category, userId] = value ? value.split(":") : [null, null];
      await departureAllocationApi.assignManual({
        stationId: dep._stationId, year, month, day, eventType: dep.eventType, eventId: dep.eventId, flightRef: dep.flightRef,
        releaserUserId: userId || null, releaserCategory: userId ? category : null, supportUserId: dep.support?.id || null,
      });
      onChanged();
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
  }

  async function setSupport(userId) {
    setBusy(true);
    try {
      await departureAllocationApi.assignManual({
        stationId: dep._stationId, year, month, day, eventType: dep.eventType, eventId: dep.eventId, flightRef: dep.flightRef,
        releaserUserId: dep.releaser?.id || null, releaserCategory: dep.releaser?.category || null, supportUserId: userId || null,
      });
      onChanged();
    } catch (err) { alert(`Failed: ${err.message}`); } finally { setBusy(false); }
  }

  const shiftLabel = dep.shiftCode ? `${SHIFT_LABEL[dep.shiftCode] || dep.shiftCode} crew · ${dep.rosterDate}` : "no shift covers this time";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", flexWrap: "wrap", fontSize: 9 }}>
      <span style={{ minWidth: 140, color: "var(--text-dim)" }}>{dep.eventType === "turn" ? "🔄" : "🛩"} {dep.flightRef} <span style={{ color: "var(--cyan)" }}>Dep {dep.depTime}</span></span>
      <span style={{ color: "var(--text-dim)", fontStyle: "italic" }} title="Only staff on this shift's real roster are offered below">from {shiftLabel}</span>
      <select className="fi" style={{ fontSize: 9, padding: "2px 4px", minWidth: 130 }} value={releaserValue} disabled={busy} onChange={e => setReleaser(e.target.value)}>
        <option value="">— Releaser (B1/CM) unassigned —</option>
        {releaserOptions.map(s => <option key={s.id} value={`${s.category}:${s.id}`}>{s.category} · {s.fullName}</option>)}
      </select>
      <select className="fi" style={{ fontSize: 9, padding: "2px 4px", minWidth: 130 }} value={dep.support?.id || ""} disabled={busy} onChange={e => setSupport(e.target.value)}>
        <option value="">— Support (NCS) unassigned —</option>
        {supportOptions.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
      </select>
      {!dep.releaser && (
        <span style={{ color: "var(--amber)" }}>⚠ no releaser — {UNFILLED_REASON_LABEL[dep.releaserUnfilledReason] || "unfilled"}</span>
      )}
      {!dep.support && (
        <span style={{ color: "var(--amber)" }}>⚠ no support — {UNFILLED_REASON_LABEL[dep.supportUnfilledReason] || "unfilled"}</span>
      )}
    </div>
  );
}

// Rendered inline under an expanded day (via FlightScheduleManager's
// renderDayExtra hook) — fetches that one day's allocation (each
// departure already carrying its own roster-resolved eligible pool),
// offers Auto-Allocate, and lets every slot be changed by hand.
function DayManpowerAllocation({ stationId, year, month, day }) {
  const [departures, setDepartures] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    departureAllocationApi.getDayAllocation(stationId, year, month, day)
      .then(rows => setDepartures(rows.map(r => ({ ...r, _stationId: stationId }))))
      .catch(err => setError(err.message));
  }, [stationId, year, month, day]);
  useEffect(load, [load]);

  async function autoAllocate() {
    setBusy(true);
    setError("");
    try {
      const rows = await departureAllocationApi.autoAllocateDay(stationId, year, month, day);
      setDepartures(rows.map(r => ({ ...r, _stationId: stationId })));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--cyan)" }}>👥 Departure Manpower Allocation</span>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 9, padding: "3px 8px" }} onClick={autoAllocate} disabled={busy || !departures?.length}>
          {busy ? "Allocating…" : "🤖 Auto-Allocate This Day"}
        </button>
      </div>
      <div style={{ fontSize: 9, color: "var(--text-dim)", marginBottom: 6 }}>
        Drawn only from who is actually on the real shift roster at each departure's time — an early-morning departure pulls from the previous night's crew (still on duty till that shift's end time), not the day's own Morning crew.
      </div>
      {error && <div className="ab red" style={{ fontSize: 9 }}>{error}</div>}
      {!departures ? (
        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>Loading…</div>
      ) : departures.length === 0 ? (
        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>No departures this day — nothing to allocate.</div>
      ) : (
        departures.map(dep => (
          <DepartureRow key={dep.key} dep={dep} year={year} month={month} day={day} onChanged={load} busy={busy} setBusy={setBusy} />
        ))
      )}
    </div>
  );
}

function KpiCard({ tone, icon, label, value, sub }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Widget({ title, children }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

// 3-segment donut for the month's days — Fully Covered / Partially Covered
// / Uncovered — same segmented-circle technique used elsewhere in the app.
const COVERAGE_COLORS = { full: "#22C55E", partial: "#FBBF24", none: "#E53935" };
function CoverageDonut({ full, partial, none }) {
  const total = full + partial + none;
  const size = 100, strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const entries = [
    { key: "full", label: "Fully Covered", value: full },
    { key: "partial", label: "Partial", value: partial },
    { key: "none", label: "Uncovered", value: none },
  ];
  let offsetAccum = 0;
  const segments = entries.filter(e => e.value > 0).map(e => {
    const frac = total > 0 ? e.value / total : 0;
    const len = frac * circumference;
    const seg = { ...e, dasharray: `${len} ${circumference - len}`, dashoffset: -offsetAccum };
    offsetAccum += len;
    return seg;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div className="gauge-ring" style={{ width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(15,23,42,.06)" strokeWidth={strokeWidth} />
          {segments.map(s => (
            <circle
              key={s.key} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={COVERAGE_COLORS[s.key]} strokeWidth={strokeWidth}
              strokeDasharray={s.dasharray} strokeDashoffset={s.dashoffset}
            />
          ))}
        </svg>
        <div className="gauge-ring-value" style={{ fontSize: 18 }}>{total}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map(e => (
          <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: COVERAGE_COLORS[e.key], display: "inline-block" }} />
            <span style={{ color: "var(--text-dim)", minWidth: 90 }}>{e.label}</span>
            <span style={{ fontWeight: 700 }}>{e.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManpowerCoverageTab({ stationId, year, month }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!stationId) return;
    setSummary(null);
    setError("");
    departureAllocationApi.getMonthManpowerSummary(stationId, year, month)
      .then(setSummary)
      .catch(err => setError(err.message));
  }, [stationId, year, month]);

  if (error) return <div className="ab red">{error}</div>;
  if (!summary) return <div className="card">Loading manpower coverage…</div>;

  if (summary.totalDepartures === 0) {
    return <div className="card"><div className="empty-note">No departures found this month — import a Turn Report on the Flight Schedule tab first.</div></div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      <Widget title="🗓 Day Coverage Breakdown">
        <CoverageDonut full={summary.fullyCoveredDays} partial={summary.partialDays} none={summary.uncoveredDays} />
      </Widget>
      <Widget title="📋 Per-Day Fill Status">
        <div style={{ overflowX: "auto", maxHeight: 380, overflowY: "auto" }}>
          <table className="dc-table">
            <thead>
              <tr><th style={{ textAlign: "left" }}>Day</th><th>Departures</th><th>Releaser Filled</th><th>Support Filled</th></tr>
            </thead>
            <tbody>
              {summary.byDay.filter(d => d.departures > 0).map(d => (
                <tr key={d.day}>
                  <td style={{ textAlign: "left", fontWeight: 700 }}>{d.day}</td>
                  <td>{d.departures}</td>
                  <td><span className={`metric-badge ${d.releaserFilled === d.departures ? "green" : d.releaserFilled === 0 ? "red" : "amber"}`}>{d.releaserFilled}/{d.departures}</span></td>
                  <td><span className={`metric-badge ${d.supportFilled === d.departures ? "green" : d.supportFilled === 0 ? "red" : "amber"}`}>{d.supportFilled}/{d.departures}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Widget>
    </div>
  );
}

export default function FlightSchedulePage() {
  const { stationId, currentStation } = useStation();
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [expandedDay, setExpandedDay] = useState(null);
  const [activeTab, setActiveTab] = useState("schedule");
  const [summary, setSummary] = useState(null);
  const [manpowerKpi, setManpowerKpi] = useState(null);

  usePageHeader({ title: "Flight Schedule", subtitle: currentStation ? `${currentStation.name} · Turn Report import & departure manpower` : "" });

  const [year, month] = monthKey.split("-").map(Number);

  const refreshManpowerKpi = useCallback(() => {
    if (!stationId) return;
    setManpowerKpi(null);
    departureAllocationApi.getMonthManpowerSummary(stationId, year, month).then(setManpowerKpi).catch(() => setManpowerKpi(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, year, month]);

  useEffect(() => { refreshManpowerKpi(); }, [refreshManpowerKpi]);

  // Fired by FlightScheduleManager whenever it (re)loads the schedule —
  // including right after a new Turn Report import — so the page-level KPI
  // row and the Manpower Coverage tab both reflect the new data without a
  // second, independent fetch of the same schedule the manager already
  // pulled (and without a manual "reload" affordance the manager itself
  // doesn't need).
  const handleScheduleChange = useCallback((s) => {
    setSummary(s.imported ? s.summary : null);
    refreshManpowerKpi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshManpowerKpi]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KpiCard tone="sky" icon="🗓" label="Operating Days" value={summary ? `${summary.operatingDays}/${summary.daysInMonth}` : "—"} sub="This month" />
        <KpiCard tone="sky" icon="✈️" label="Total Movements" value={summary ? summary.totalMovements : "—"} sub="Takeoffs + landings" />
        <KpiCard tone="neutral" icon="📊" label="Avg Daily Movements" value={summary ? summary.avgDailyMovements : "—"} sub="Per operating day" />
        <KpiCard tone="amber" icon="📈" label="Peak Daily Movements" value={summary ? summary.peakDailyMovements : "—"} sub={summary?.peakDate || "—"} />
        <KpiCard
          tone={manpowerKpi?.coveragePct == null ? "neutral" : manpowerKpi.coveragePct >= 90 ? "green" : manpowerKpi.coveragePct >= 70 ? "amber" : "red"}
          icon="👥" label="Manpower Coverage" value={manpowerKpi?.coveragePct != null ? `${manpowerKpi.coveragePct}%` : "—"}
          sub={manpowerKpi ? `${manpowerKpi.releaserFilled + manpowerKpi.supportFilled}/${manpowerKpi.totalDepartures * 2} slots filled` : "No departures"}
        />
      </div>

      <div className="view-toggle" style={{ marginBottom: 14 }}>
        <button className={`view-toggle-btn ${activeTab === "schedule" ? "active" : ""}`} onClick={() => setActiveTab("schedule")}>✈ Flight Schedule</button>
        <button className={`view-toggle-btn ${activeTab === "manpower" ? "active" : ""}`} onClick={() => setActiveTab("manpower")}>👥 Manpower Coverage</button>
      </div>

      {activeTab === "schedule" ? (
        <FlightScheduleManager
          stationId={stationId}
          monthKey={monthKey}
          onMonthKeyChange={setMonthKey}
          expandedDay={expandedDay}
          onDayClick={setExpandedDay}
          onScheduleChange={handleScheduleChange}
          renderDayExtra={(d) => (
            <DayManpowerAllocation stationId={stationId} year={year} month={month} day={d} />
          )}
        />
      ) : (
        <ManpowerCoverageTab stationId={stationId} year={year} month={month} />
      )}
    </div>
  );
}
