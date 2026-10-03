// TASK ALLOCATION MODULE — Settings: Allocation Rules (Task Generator config,
// Sections 7-8), Optimizer Weights (Section 10), Travel Time Matrix (Section
// 11), and daily Flight Instances entry (Section 6).
import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../../store/PageHeaderContext.jsx";
import { useStation } from "../../store/StationContext.jsx";
import * as taApi from "../../api/taskAllocation.js";

function todayIso() { return new Date().toISOString().slice(0, 10); }
// Flight Instance std/sta are "wall-clock stamped as UTC" (same convention
// as the Flight Schedule module's own HH:MM figures, and as this page's own
// manual-entry `${date}T${hh}:00.000Z` below) — a flight at 22:35 station
// time is stored as 22:35Z, literally. Reading it back with
// toLocaleTimeString() converts to the BROWSER's timezone and silently
// shows the wrong clock time (and sometimes the wrong day) for anyone not
// viewing from UTC+0; UTC getters read the stamped value back as typed.
function hhmm(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const WEIGHT_FIELDS = [
  ["weightDeadline", "Deadline / task criticality"], ["weightWorkloadBalance", "Current workload balance"],
  ["weightTravelTime", "Travel time"], ["weightTaskContinuity", "Task continuity"],
  ["weightResourceUtilization", "Resource utilization"], ["weightIdleTimeReduction", "Idle time reduction"], ["weightFairness", "Fairness"],
];

export default function TaskAllocationSettingsPage() {
  const { stationId } = useStation();
  const [tab, setTab] = useState("rules");
  usePageHeader({ title: "Task Allocation Settings", subtitle: "Task Generator rules, optimizer weights, travel time, and today's flight instances" });

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[["rules", "Allocation Rules"], ["weights", "Optimizer Weights"], ["travel", "Travel Time Matrix"], ["flights", "Flight Instances"]].map(([key, label]) => (
          <button key={key} className={`view-toggle-btn ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === "rules" && <RulesTab stationId={stationId} />}
      {tab === "weights" && <WeightsTab stationId={stationId} />}
      {tab === "travel" && <TravelTab stationId={stationId} />}
      {tab === "flights" && <FlightsTab stationId={stationId} />}
    </div>
  );
}

function RulesTab({ stationId }) {
  const [rules, setRules] = useState([]);
  const [draft, setDraft] = useState(null);
  const load = useCallback(() => { if (stationId) taApi.listRules(stationId).then(setRules); }, [stationId]);
  useEffect(() => { load(); }, [load]);

  function newDraft() {
    setDraft({
      stationId, ruleName: "", taskType: "", appliesTo: "BOTH", onlyTransit: false,
      startOffsetMin: -60, latestStartOffsetMin: -50, deadlineOffsetMin: -15, durationMin: 45,
      requiredCategory: "", requiredAircraftType: "", teamSize: 1, priority: 3, isEnabled: true,
    });
  }
  async function save() {
    try {
      await taApi.upsertRule({ ...draft, requiredCategory: draft.requiredCategory || null });
      setDraft(null); load();
    } catch (err) { alert(`Failed: ${err.message}`); }
  }
  async function remove(id) {
    if (!confirm("Delete this rule?")) return;
    await taApi.deleteRule(id); load();
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div className="card-title">Allocation Rules — how the Task Generator converts a flight into tasks</div>
        <button className="btn btn-primary btn-sm" onClick={newDraft}>+ New Rule</button>
      </div>
      <table className="dc-table">
        <thead><tr><th>Name</th><th>Task Type</th><th>Applies To</th><th>Start</th><th>Latest</th><th>Deadline</th><th>Duration</th><th>Required</th><th></th></tr></thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id}>
              <td>{r.ruleName}{!r.isEnabled && " (disabled)"}</td>
              <td>{r.taskType}</td><td>{r.appliesTo}</td>
              <td>{r.startOffsetMin}min</td><td>{r.latestStartOffsetMin}min</td><td>{r.deadlineOffsetMin}min</td><td>{r.durationMin}min</td>
              <td>{r.requiredCategory || "—"}{r.requiredAircraftType ? ` / ${r.requiredAircraftType}` : ""}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => remove(r.id)}>🗑</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft && (
        <div className="card" style={{ marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input className="fi" placeholder="Rule name" value={draft.ruleName} onChange={e => setDraft(d => ({ ...d, ruleName: e.target.value }))} />
            <input className="fi" placeholder="Task type (e.g. TRANSIT, PDC, DEFECT)" value={draft.taskType} onChange={e => setDraft(d => ({ ...d, taskType: e.target.value }))} />
            <select className="fi" value={draft.appliesTo} onChange={e => setDraft(d => ({ ...d, appliesTo: e.target.value }))}>
              <option value="ARRIVAL">Arrival (STA)</option><option value="DEPARTURE">Departure (STD)</option><option value="BOTH">Both</option>
            </select>
            <select className="fi" value={draft.requiredCategory} onChange={e => setDraft(d => ({ ...d, requiredCategory: e.target.value }))}>
              <option value="">Any category</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <label style={{ fontSize: 10 }}>Start offset (min, before anchor = negative)
              <input className="fi" type="number" value={draft.startOffsetMin} onChange={e => setDraft(d => ({ ...d, startOffsetMin: +e.target.value }))} />
            </label>
            <label style={{ fontSize: 10 }}>Latest start offset (min)
              <input className="fi" type="number" value={draft.latestStartOffsetMin} onChange={e => setDraft(d => ({ ...d, latestStartOffsetMin: +e.target.value }))} />
            </label>
            <label style={{ fontSize: 10 }}>Deadline offset (min)
              <input className="fi" type="number" value={draft.deadlineOffsetMin} onChange={e => setDraft(d => ({ ...d, deadlineOffsetMin: +e.target.value }))} />
            </label>
            <label style={{ fontSize: 10 }}>Duration (min)
              <input className="fi" type="number" value={draft.durationMin} onChange={e => setDraft(d => ({ ...d, durationMin: +e.target.value }))} />
            </label>
            <input className="fi" placeholder="Required aircraft type (optional)" value={draft.requiredAircraftType} onChange={e => setDraft(d => ({ ...d, requiredAircraftType: e.target.value }))} />
            <label style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={draft.onlyTransit} onChange={e => setDraft(d => ({ ...d, onlyTransit: e.target.checked }))} /> Only for transit flights
            </label>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function WeightsTab({ stationId }) {
  const [settings, setSettings] = useState(null);
  useEffect(() => { if (stationId) taApi.getSettings(stationId).then(setSettings); }, [stationId]);
  async function save() {
    try {
      await taApi.updateSettings(stationId, settings);
      alert("Saved.");
    } catch (err) { alert(`Failed: ${err.message}`); }
  }
  if (!settings) return <div className="card">Loading…</div>;
  const total = WEIGHT_FIELDS.reduce((sum, [key]) => sum + (settings[key] || 0), 0);
  return (
    <div className="card">
      <div className="card-title">Assignment Optimizer Weights</div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>Used to RANK already-eligible candidates only — never compensates a failed hard constraint. Current total: {total}%</div>
      {WEIGHT_FIELDS.map(([key, label]) => (
        <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 11, width: 220 }}>{label}</span>
          <input type="range" min={0} max={100} value={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: +e.target.value }))} style={{ flex: 1 }} />
          <span style={{ fontSize: 11, width: 40, textAlign: "right" }}>{settings[key]}%</span>
        </div>
      ))}
      <label style={{ fontSize: 11, display: "block", marginTop: 10 }}>Task Board auto-refresh interval (seconds)
        <input className="fi" type="number" min={10} value={settings.autoRefreshSeconds} onChange={e => setSettings(s => ({ ...s, autoRefreshSeconds: +e.target.value }))} style={{ width: 120, marginLeft: 8 }} />
      </label>
      <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={save}>Save Weights</button>
    </div>
  );
}

function TravelTab({ stationId }) {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({ fromLocation: "", toLocation: "", minutes: 5 });
  const load = useCallback(() => { if (stationId) taApi.listTravelTimes(stationId).then(setRows); }, [stationId]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    if (!draft.fromLocation || !draft.toLocation) return;
    await taApi.upsertTravelTime({ stationId, ...draft });
    setDraft({ fromLocation: "", toLocation: "", minutes: 5 }); load();
  }
  async function remove(id) { await taApi.deleteTravelTime(id); load(); }
  return (
    <div className="card">
      <div className="card-title">Travel Time Matrix (minutes between locations)</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input className="fi" placeholder="From (e.g. Stand 1)" value={draft.fromLocation} onChange={e => setDraft(d => ({ ...d, fromLocation: e.target.value }))} />
        <input className="fi" placeholder="To (e.g. Stand 10)" value={draft.toLocation} onChange={e => setDraft(d => ({ ...d, toLocation: e.target.value }))} />
        <input className="fi" type="number" min={0} value={draft.minutes} onChange={e => setDraft(d => ({ ...d, minutes: +e.target.value }))} style={{ width: 90 }} />
        <button className="btn btn-primary btn-sm" onClick={add}>Add</button>
      </div>
      <table className="dc-table">
        <thead><tr><th>From</th><th>To</th><th>Minutes</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}><td>{r.fromLocation}</td><td>{r.toLocation}</td><td>{r.minutes}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => remove(r.id)}>🗑</button></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY_DRAFT = { id: undefined, flightNumber: "", aircraftRegistration: "", aircraftType: "", std: "", sta: "", stand: "", terminal: "", isTransit: true };

function FlightsTab({ stationId }) {
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");

  // Auto-fetches this date's flights (flight number, STD/STA, and a
  // Transit/PDC guess from ground time) from the Flight Schedule module
  // (the Turn Report/Charter import) every time the date changes. That
  // module has no registration, stand or terminal at all, so those three —
  // and anything it doesn't carry at all (e.g. a charter) — always stay
  // filled in by hand: click a synced row to add them, or use Add for a
  // flight the schedule doesn't have.
  const sync = useCallback(() => {
    if (!stationId) return;
    setSyncing(true);
    taApi.syncFlightInstances(stationId, date)
      .then(r => { setRows(r.flightInstances); setSyncNote(`Synced ${r.syncedCount} from Flight Schedule.`); })
      .catch(err => setSyncNote(`Couldn't sync: ${err.message}`))
      .finally(() => setSyncing(false));
  }, [stationId, date]);
  useEffect(() => { sync(); }, [sync]);

  async function save() {
    if (!draft.flightNumber) return;
    await taApi.upsertFlightInstance({
      id: draft.id, stationId, flightDate: date, flightNumber: draft.flightNumber, aircraftRegistration: draft.aircraftRegistration || null,
      aircraftType: draft.aircraftType || undefined, stand: draft.stand || undefined, terminal: draft.terminal || undefined,
      isTransit: draft.isTransit,
      std: draft.std ? `${date}T${draft.std}:00.000Z` : undefined,
      sta: draft.sta ? `${date}T${draft.sta}:00.000Z` : undefined,
    });
    setDraft(EMPTY_DRAFT);
    taApi.listFlightInstances(stationId, date, date).then(setRows);
  }
  function edit(r) {
    setDraft({
      id: r.id, flightNumber: r.flightNumber, aircraftRegistration: r.aircraftRegistration || "", aircraftType: r.aircraftType || "",
      std: r.std ? new Date(r.std).toISOString().slice(11, 16) : "", sta: r.sta ? new Date(r.sta).toISOString().slice(11, 16) : "",
      stand: r.stand || "", terminal: r.terminal || "", isTransit: r.isTransit,
    });
  }
  async function remove(id) { await taApi.deleteFlightInstance(id); taApi.listFlightInstances(stationId, date, date).then(setRows); }

  return (
    <div className="card">
      <div className="card-title">Today's Real Flight Instances — the Task Generator's daily input</div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
        Flight number, STD/STA and a Transit/PDC guess are fetched automatically from the Flight Schedule module for the date below. Registration, stand and terminal aren't in that schedule — fill them in by clicking a row, or use Add for a flight it doesn't carry (e.g. a charter).
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <input type="date" className="fi" value={date} onChange={e => setDate(e.target.value)} style={{ width: 160 }} />
        <button className="btn btn-ghost btn-sm" onClick={sync} disabled={syncing}>{syncing ? "Syncing…" : "🔄 Sync now"}</button>
        {syncNote && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{syncNote}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
        <input className="fi" placeholder="Flight No." value={draft.flightNumber} onChange={e => setDraft(d => ({ ...d, flightNumber: e.target.value }))} />
        <input className="fi" placeholder="Registration (VT-XAA)" value={draft.aircraftRegistration} onChange={e => setDraft(d => ({ ...d, aircraftRegistration: e.target.value }))} />
        <input className="fi" placeholder="Aircraft type" value={draft.aircraftType} onChange={e => setDraft(d => ({ ...d, aircraftType: e.target.value }))} />
        <input className="fi" type="time" placeholder="STD" value={draft.std} onChange={e => setDraft(d => ({ ...d, std: e.target.value }))} />
        <input className="fi" type="time" placeholder="STA" value={draft.sta} onChange={e => setDraft(d => ({ ...d, sta: e.target.value }))} />
        <input className="fi" placeholder="Stand" value={draft.stand} onChange={e => setDraft(d => ({ ...d, stand: e.target.value }))} />
        <input className="fi" placeholder="Terminal" value={draft.terminal} onChange={e => setDraft(d => ({ ...d, terminal: e.target.value }))} />
        <div style={{ display: "flex", gap: 7 }}>
          <button className="btn btn-primary btn-sm" onClick={save}>{draft.id ? "Save" : "Add"}</button>
          {draft.id && <button className="btn btn-ghost btn-sm" onClick={() => setDraft(EMPTY_DRAFT)}>Cancel</button>}
        </div>
      </div>
      <table className="dc-table">
        <thead><tr><th>Flight</th><th>Reg</th><th>Type</th><th>STD</th><th>STA</th><th>Stand</th><th>Terminal</th><th>Source</th><th></th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} onClick={() => edit(r)} style={{ cursor: "pointer" }}>
              <td>{r.flightNumber}</td><td>{r.aircraftRegistration || "—"}</td><td>{r.aircraftType || "—"}</td>
              <td>{hhmm(r.std)}</td><td>{hhmm(r.sta)}</td>
              <td>{r.stand || "—"}</td><td>{r.terminal || "—"}</td>
              <td style={{ fontSize: 9, color: "var(--text-dim)" }}>{r.source === "AUTO_GENERATED" ? "Synced" : "Manual"}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); remove(r.id); }}>🗑</button></td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} style={{ padding: 12, fontSize: 11, color: "var(--text-dim)" }}>No flights for this date yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
