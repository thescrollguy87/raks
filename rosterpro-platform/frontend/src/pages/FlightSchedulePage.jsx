import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as departureAllocationApi from "../api/departureAllocation.js";
import FlightScheduleManager from "../components/flights/FlightScheduleManager.jsx";

// One departure row: shows the current releaser (B1 or CM — either
// qualifies to give a departure) + support (NCS), each editable via a
// dropdown that calls the manual-assign endpoint directly on change —
// auto-allocate fills the day in one click, but every slot stays a plain
// dropdown a planner can override by hand at any time.
function DepartureRow({ dep, year, month, day, staffByCategory, onChanged, busy, setBusy }) {
  const releaserOptions = [...staffByCategory.B1, ...staffByCategory.CM];
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

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", flexWrap: "wrap", fontSize: 9 }}>
      <span style={{ minWidth: 140, color: "var(--text-dim)" }}>{dep.eventType === "turn" ? "🔄" : "🛩"} {dep.flightRef} <span style={{ color: "var(--cyan)" }}>Dep {dep.depTime}</span></span>
      <select className="fi" style={{ fontSize: 9, padding: "2px 4px", minWidth: 130 }} value={releaserValue} disabled={busy} onChange={e => setReleaser(e.target.value)}>
        <option value="">— Releaser (B1/CM) unassigned —</option>
        {releaserOptions.map(s => <option key={s.id} value={`${s.category}:${s.id}`}>{s.category} · {s.fullName}</option>)}
      </select>
      <select className="fi" style={{ fontSize: 9, padding: "2px 4px", minWidth: 130 }} value={dep.support?.id || ""} disabled={busy} onChange={e => setSupport(e.target.value)}>
        <option value="">— Support (NCS) unassigned —</option>
        {staffByCategory.NCS.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
      </select>
      {(!dep.releaser || !dep.support) && <span style={{ color: "var(--amber)" }}>⚠ incomplete</span>}
    </div>
  );
}

// Rendered inline under an expanded day (via FlightScheduleManager's
// renderDayExtra hook) — fetches that one day's allocation, offers
// Auto-Allocate, and lets every slot be changed by hand.
function DayManpowerAllocation({ stationId, year, month, day, staffByCategory }) {
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
      {error && <div className="ab red" style={{ fontSize: 9 }}>{error}</div>}
      {!departures ? (
        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>Loading…</div>
      ) : departures.length === 0 ? (
        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>No departures this day — nothing to allocate.</div>
      ) : (
        departures.map(dep => (
          <DepartureRow key={dep.key} dep={dep} year={year} month={month} day={day} staffByCategory={staffByCategory} onChanged={load} busy={busy} setBusy={setBusy} />
        ))
      )}
    </div>
  );
}

export default function FlightSchedulePage() {
  const { stationId, currentStation } = useStation();
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [expandedDay, setExpandedDay] = useState(null);
  const [staffByCategory, setStaffByCategory] = useState({ B1: [], CM: [], NCS: [] });

  usePageHeader({ title: "Flight Schedule", subtitle: currentStation ? `${currentStation.name} · Turn Report import & departure manpower` : "" });

  useEffect(() => {
    if (!stationId) return;
    departureAllocationApi.listEligibleStaff(stationId).then(staff => {
      const byCat = { B1: [], CM: [], NCS: [] };
      staff.forEach(s => { if (byCat[s.category]) byCat[s.category].push(s); });
      setStaffByCategory(byCat);
    }).catch(() => {});
  }, [stationId]);

  const [year, month] = monthKey.split("-").map(Number);

  return (
    <FlightScheduleManager
      stationId={stationId}
      monthKey={monthKey}
      onMonthKeyChange={setMonthKey}
      expandedDay={expandedDay}
      onDayClick={setExpandedDay}
      renderDayExtra={(d) => (
        <DayManpowerAllocation stationId={stationId} year={year} month={month} day={d} staffByCategory={staffByCategory} />
      )}
    />
  );
}
