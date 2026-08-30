import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as rosterApi from "../api/roster.js";
import * as planningApi from "../api/rosterPlanning.js";
import * as staffApi from "../api/staff.js";
import * as leaveApi from "../api/leave.js";
import * as flightScheduleApi from "../api/flightSchedule.js";
import * as workloadConfigApi from "../api/workloadConfig.js";
import * as ruleBuilderApi from "../api/ruleBuilder.js";
import * as dailyOpsApi from "../api/dailyOps.js";

const CAT_LABELS = { B1: "B1 AME", B2: "B2 AME", CM: "Certifying Mechanic", NCS: "NCS / Tech", STO: "Stores" };
const SHIFT_LABELS = { M: "Morning", A: "Afternoon", N: "Night" };
const SHIFT_TYPES = ["duty", "night", "off", "leave", "other"];
const WORKLOAD_SECTIONS = [
  { key: "transit", title: "🛬 Transit Flights", countLabel: "Count/day" },
  { key: "nighthalt", title: "🌙 Night Halt Workscope", countLabel: "Freq/month" },
  { key: "clash", title: "⚡ Clashing Departures", countLabel: "Max/day" },
  { key: "task", title: "🔧 Planned Tasks & Checks", countLabel: "Count/month" },
];
const LEAVE_TYPE_OPTIONS = [
  { value: "ANNUAL", label: "L — Annual/Earned" },
  { value: "SICK", label: "SL — Sick" },
  { value: "CASUAL", label: "CL — Casual" },
  { value: "MEDICAL", label: "ML — Medical" },
  { value: "LWP", label: "LWP — Leave W/O Pay" },
  { value: "TRAINING", label: "TRG — Training" },
  { value: "OTHER", label: "Other" },
];

// The RosterPro PWA's Auto-Roster Generator is a 6-tab wizard — Shift
// Definitions, Shift Patterns, Staff Allocation, Leave & Absence, Workload
// Input, Generate — backed by real station-scoped data (ShiftPattern,
// StaffShiftAllocation, WorkloadItem) instead of that PWA's in-browser-only
// arrays, feeding the same buildRosterAssignments()/computeManpowerPlan()
// ports used everywhere else in this app.
export default function AutoRosterPage() {
  const { stationId, currentStation } = useStation();
  const [tab, setTab] = useState("defs");

  usePageHeader({ title: "Auto-Roster Generator", subtitle: currentStation ? `${currentStation.name} Line Maintenance` : "" });

  const TABS = [
    { key: "defs", label: "⏱ Shift Definitions" },
    { key: "patterns", label: "🔁 Shift Patterns" },
    { key: "allocation", label: "👤 Staff Allocation" },
    { key: "leave", label: "🌴 Leave & Absence" },
    { key: "flightschedule", label: "✈ Flight Schedule" },
    { key: "workload", label: "📦 Workload Input" },
    { key: "workloadconfig", label: "⚙ Workload Config" },
    { key: "rulebuilder", label: "📐 Rule Builder" },
    { key: "dailyops", label: "📅 Daily Ops" },
    { key: "generate", label: "🤖 Generate" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t.key} className={`tab-btn ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === "defs" && <ShiftDefinitionsTab />}
      {tab === "patterns" && <ShiftPatternsTab stationId={stationId} />}
      {tab === "allocation" && <StaffAllocationTab stationId={stationId} />}
      {tab === "leave" && <LeaveAbsenceTab stationId={stationId} />}
      {tab === "flightschedule" && <FlightScheduleTab stationId={stationId} />}
      {tab === "workload" && <WorkloadInputTab stationId={stationId} />}
      {tab === "workloadconfig" && <WorkloadConfigTab stationId={stationId} />}
      {tab === "rulebuilder" && <RuleBuilderTab stationId={stationId} />}
      {tab === "dailyops" && <DailyOpsTab stationId={stationId} />}
      {tab === "generate" && <GenerateTab stationId={stationId} />}
    </div>
  );
}

// ═══ TAB 1: SHIFT DEFINITIONS ════════════════════════════════════════════════
function ShiftDefinitionsTab() {
  const [defs, setDefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    rosterApi.getShiftDefinitions().then(setDefs).catch(err => setError(err.message));
  }, []);
  useEffect(load, [load]);

  function netHours(d) {
    if (!d.startTime || !d.endTime) return 0;
    const [sh, sm] = d.startTime.split(":").map(Number);
    const [eh, em] = d.endTime.split(":").map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    return Math.max(0, (mins - (d.breakMin || 0)) / 60);
  }

  function updateField(id, field, value) {
    setDefs(list => list.map(d => (d.id === id ? { ...d, [field]: value } : d)));
  }

  async function save(d) {
    setBusy(true);
    setError("");
    try {
      await planningApi.upsertShiftDefinition({
        code: d.code, name: d.name, startTime: d.startTime || null, endTime: d.endTime || null,
        breakMin: Number(d.breakMin) || 0, type: d.type, color: d.color,
      });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function addNew() {
    setBusy(true);
    setError("");
    try {
      await planningApi.upsertShiftDefinition({ code: "NEW" + Math.floor(Math.random() * 900 + 100), name: "New Shift", breakMin: 0, type: "duty", color: "#AABBCC" });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    setBusy(true);
    setError("");
    try { await planningApi.deleteShiftDefinition(id); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!defs) return <div className="card">Loading…</div>;

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <div className="card-title">⏱ Define Shifts & Timings</div>
          {error && <div className="ab red">{error}</div>}
          <div className="wl-scroll">
            {defs.map(d => (
              <div key={d.id} style={{ display: "grid", gridTemplateColumns: "60px minmax(140px,2fr) 100px 100px 60px 90px 50px 32px", gap: 7, marginBottom: 6, alignItems: "center" }}>
                <input className="fi" value={d.code} style={{ fontSize: 10, fontWeight: 700, color: d.color }}
                  onChange={e => updateField(d.id, "code", e.target.value.toUpperCase())} onBlur={() => save(defs.find(x => x.id === d.id))} disabled={busy} />
                <input className="fi" value={d.name} style={{ fontSize: 10 }}
                  onChange={e => updateField(d.id, "name", e.target.value)} onBlur={() => save(defs.find(x => x.id === d.id))} disabled={busy} />
                <input className="fi" type="time" value={d.startTime || ""} style={{ fontSize: 10 }}
                  onChange={e => updateField(d.id, "startTime", e.target.value)} onBlur={() => save(defs.find(x => x.id === d.id))} disabled={busy} />
                <input className="fi" type="time" value={d.endTime || ""} style={{ fontSize: 10 }}
                  onChange={e => updateField(d.id, "endTime", e.target.value)} onBlur={() => save(defs.find(x => x.id === d.id))} disabled={busy} />
                <input className="fi" type="number" min="0" value={d.breakMin} style={{ fontSize: 10, textAlign: "center" }}
                  onChange={e => updateField(d.id, "breakMin", e.target.value)} onBlur={() => save(defs.find(x => x.id === d.id))} disabled={busy} />
                <select className="fi" value={d.type} style={{ fontSize: 10 }}
                  onChange={e => { updateField(d.id, "type", e.target.value); save({ ...d, type: e.target.value }); }} disabled={busy}>
                  {SHIFT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="color" value={d.color} title="Shift colour" style={{ width: "100%", height: 28, padding: 2, border: "1px solid var(--border)", borderRadius: 6, background: "var(--navy-lite)", cursor: "pointer" }}
                  onChange={e => { updateField(d.id, "color", e.target.value); save({ ...d, color: e.target.value }); }} disabled={busy} />
                <button className="wl-del" onClick={() => remove(d.id)} disabled={busy}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addNew} disabled={busy}>＋ Add Shift</button>
        </div>
      </div>
      <div>
        <div className="card">
          <div className="card-title">🎨 Shift Colour Preview</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {defs.filter(d => d.code && d.name).map(d => {
              const hrs = netHours(d);
              return (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ display: "inline-block", minWidth: 42, padding: "2px 5px", borderRadius: 4, background: hexToRgba(d.color, 0.14), color: d.color, fontWeight: 800, fontSize: 10, textAlign: "center" }}>{d.code}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--mono)" }}>{d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : "—"}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: hrs > 0 ? "var(--green)" : "var(--text-dim)" }}>{hrs > 0 ? hrs.toFixed(1) + "h" : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function hexToRgba(hex, alpha) {
  const h = (hex || "#AABBCC").replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

// Mirrors backend/src/utils/shiftPatternCycle.js's parseCycle() exactly — a
// naive character split would break any pattern using a multi-char code
// (e.g. "G2G2G2OO" is 5 codes — G2, G2, G2, O, O — not 8 single letters;
// "DEP" is 1 code, not 3). Tried longest-known-code-first, same as the
// backend, so the preview here always matches what the server will
// actually schedule.
function parseCycle(cycle, knownCodes) {
  const codes = [];
  const str = (cycle || "").toUpperCase().replace(/\s/g, "");
  const multiCodes = (knownCodes || []).filter(c => c.length > 1).sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < str.length) {
    let matched = false;
    for (const mc of multiCodes) {
      if (str.startsWith(mc, i)) { codes.push(mc); i += mc.length; matched = true; break; }
    }
    if (!matched) { codes.push(str[i]); i++; }
  }
  return codes.length ? codes : ["O"];
}

// ═══ TAB 2: SHIFT PATTERNS ════════════════════════════════════════════════════
function ShiftPatternsTab({ stationId }) {
  const [patterns, setPatterns] = useState(null);
  const [knownCodes, setKnownCodes] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!stationId) return;
    planningApi.listPatterns(stationId).then(setPatterns).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(load, [load]);
  useEffect(() => { rosterApi.getShiftDefinitions().then(defs => setKnownCodes(defs.map(d => d.code))).catch(() => {}); }, []);

  function updateField(id, field, value) {
    setPatterns(list => list.map(p => (p.id === id ? { ...p, [field]: value } : p)));
  }

  async function save(p) {
    setBusy(true);
    setError("");
    try {
      await planningApi.upsertPattern({ id: p.id, stationId, code: p.code, name: p.name, cycle: p.cycle.toUpperCase().replace(/\s/g, "") });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function addNew() {
    setBusy(true);
    setError("");
    try {
      await planningApi.upsertPattern({ stationId, code: "P" + (patterns.length + 1), name: "New Pattern", cycle: "MMAANNOO" });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    setBusy(true);
    setError("");
    try { await planningApi.deletePattern(id); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!patterns) return <div className="card">Loading…</div>;

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <div className="card-title">🔁 Define Shift Patterns</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
            A pattern is a repeating cycle (e.g. MMAANNOO = 2 Morning, 2 Afternoon, 2 Night, 2 Off). Use shift codes separated by nothing. Cycle length = number of characters/codes.
          </div>
          {error && <div className="ab red">{error}</div>}
          {patterns.map(p => (
            <div key={p.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 32px", gap: 7, alignItems: "center", marginBottom: 4 }}>
                <input className="fi" value={p.code} style={{ fontSize: 10, fontWeight: 700 }} onChange={e => updateField(p.id, "code", e.target.value)} onBlur={() => save(patterns.find(x => x.id === p.id))} disabled={busy} />
                <input className="fi" value={p.name} style={{ fontSize: 10 }} onChange={e => updateField(p.id, "name", e.target.value)} onBlur={() => save(patterns.find(x => x.id === p.id))} disabled={busy} />
                <input className="fi" value={p.cycle} style={{ fontSize: 10, fontFamily: "var(--mono)", letterSpacing: 1 }} onChange={e => updateField(p.id, "cycle", e.target.value)} onBlur={() => save(patterns.find(x => x.id === p.id))} disabled={busy} />
                <button className="wl-del" onClick={() => remove(p.id)} disabled={busy}>✕</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {(() => {
                  const codes = parseCycle(p.cycle, knownCodes);
                  return <>
                    {codes.slice(0, 14).map((c, i) => <span key={i} style={{ padding: "1px 5px", borderRadius: 3, background: "rgba(0,198,255,.1)", color: "var(--cyan)", fontSize: 9, fontWeight: 700 }}>{c}</span>)}
                    {codes.length > 14 && <span style={{ fontSize: 9, color: "var(--text-dim)" }}>+{codes.length - 14} more</span>}
                    <span style={{ fontSize: 9, color: "var(--text-dim)", marginLeft: 4 }}>({codes.length}-day cycle)</span>
                  </>;
                })()}
              </div>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={addNew} disabled={busy}>＋ Add Pattern</button>
        </div>
      </div>
      <div>
        <div className="card">
          <div className="card-title">📖 Pattern Reference</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div><strong style={{ color: "var(--cyan)" }}>MMAANNOO</strong> — 2M 2A 2N 2Off (standard 8-day cycle)</div>
            <div><strong style={{ color: "var(--cyan)" }}>NNOO</strong> — 2 Nights then 2 Off</div>
            <div><strong style={{ color: "var(--cyan)" }}>GGGGGGO</strong> — 6 General + 1 Off (weekly)</div>
            <div><strong style={{ color: "var(--cyan)" }}>MMMMMMO</strong> — 6 Morning + 1 Off</div>
            <div><strong style={{ color: "var(--cyan)" }}>AAAAAAO</strong> — 6 Afternoon + 1 Off</div>
            <div><strong style={{ color: "var(--cyan)" }}>DEP</strong> — Deputation (marks all days as SOD)</div>
            <div><strong style={{ color: "var(--cyan)" }}>FS</strong> — All days Flexi Shift</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══ TAB 3: STAFF ALLOCATION ══════════════════════════════════════════════════
function StaffAllocationTab({ stationId }) {
  const [rows, setRows] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!stationId) return;
    Promise.all([planningApi.listAllocations(stationId), planningApi.listPatterns(stationId)])
      .then(([allocs, pats]) => { setRows(allocs); setPatterns(pats); })
      .catch(err => setError(err.message));
  }, [stationId]);
  useEffect(load, [load]);

  async function save(userId, patternId, cycleStartDay) {
    setBusy(true);
    setError("");
    try {
      await planningApi.upsertAllocation({ userId, patternId: patternId || null, cycleStartDay: Number(cycleStartDay) || 0 });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function autoPatternForCat(cat) {
    if (cat === "STO") return patterns.find(p => p.code === "P6")?.id || patterns[0]?.id;
    return patterns[0]?.id || null;
  }

  async function autoAllocate() {
    setBusy(true);
    setError("");
    try {
      for (let i = 0; i < rows.length; i++) {
        await planningApi.upsertAllocation({ userId: rows[i].userId, patternId: autoPatternForCat(rows[i].category), cycleStartDay: i % 8 });
      }
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!rows) return <div className="card">Loading…</div>;

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>👤 Assign Staff to Shift Patterns</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={autoAllocate} disabled={busy || !patterns.length}>Auto-Allocate</button>
        </div>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
        Assign each active staff member to a shift pattern and a start offset (which day of the cycle they begin on). Leave as MANUAL to keep the default 8-day auto-distribute rotation.
      </div>
      {error && <div className="ab red">{error}</div>}
      <div className="wl-scroll">
        <table className="rt" style={{ width: "100%" }}>
          <thead><tr><th style={{ textAlign: "left", paddingLeft: 9 }}>Staff</th><th>Category</th><th>Shift Pattern</th><th>Cycle Start Day</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.userId}>
                <td style={{ textAlign: "left", paddingLeft: 9, fontWeight: 600 }}>{r.fullName}</td>
                <td><span className={`cat-tag cat-${r.category || "NCS"}`}>{r.category || "NCS"}</span></td>
                <td>
                  <select className="fi" style={{ fontSize: 10 }} value={r.patternId || ""} disabled={busy}
                    onChange={e => save(r.userId, e.target.value, r.cycleStartDay)}>
                    <option value="">MANUAL (no pattern)</option>
                    {patterns.map(p => <option key={p.id} value={p.id}>{p.code}: {p.name}</option>)}
                  </select>
                </td>
                <td>
                  <input className="fi" type="number" min="0" max="60" style={{ fontSize: 10, textAlign: "center", width: 70 }} value={r.cycleStartDay} disabled={busy}
                    onChange={e => setRows(list => list.map(x => (x.userId === r.userId ? { ...x, cycleStartDay: e.target.value } : x)))}
                    onBlur={e => save(r.userId, r.patternId, e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══ TAB 4: LEAVE & ABSENCE ═══════════════════════════════════════════════════
function LeaveAbsenceTab({ stationId }) {
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [staff, setStaff] = useState([]);
  const [userId, setUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [leaveType, setLeaveType] = useState("ANNUAL");
  const [entries, setEntries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!stationId) return;
    staffApi.listStaff({ stationId, pageSize: 500 }).then(r => {
      const list = r.items || r;
      setStaff(list);
      if (!userId && list.length) setUserId(list[0].id);
    }).catch(() => {});
  }, [stationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEntries = useCallback(() => {
    if (!stationId) return;
    const from = `${monthKey}-01`;
    const to = `${monthKey}-31`;
    leaveApi.listLeave({ stationId, status: "APPROVED", from, to, pageSize: 100 })
      .then(r => setEntries(r.items || r))
      .catch(err => setError(err.message));
  }, [stationId, monthKey]);
  useEffect(loadEntries, [loadEntries]);

  async function addLeave() {
    if (!userId || !fromDate || !toDate) { setError("Staff, From Date and To Date are required"); return; }
    setBusy(true);
    setError("");
    try {
      const created = await leaveApi.requestLeave({ userId, leaveType, fromDate, toDate });
      // This tab is an admin/manager tool for recording already-known leave
      // directly onto the roster plan (matching the PWA's single-step "+Add
      // Leave" with no separate approval step), so immediately approve it —
      // the algorithm only ever reads APPROVED leave. If the actor doesn't
      // have approval rights over this person, this 403s and the error
      // surfaces rather than silently leaving it pending.
      await leaveApi.decideLeave(created.id, "APPROVED");
      setFromDate(""); setToDate("");
      loadEntries();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const byStaff = {};
  for (const e of entries || []) (byStaff[e.leaveType] ??= []).push(e);

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <div className="card-title">🌴 Leave Entries for Target Month</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
            Enter approved leave/absence for each staff member. These days will automatically be marked on the roster and that staff cannot be manually or auto-rostered on those dates.
          </div>
          {error && <div className="ab red">{error}</div>}
          <div className="fg2" style={{ marginBottom: 10 }}>
            <div className="fg"><label className="fl">Target Month</label><input className="fi" type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} /></div>
            <div className="fg"><label className="fl">Add Leave For</label>
              <select className="fi" value={userId} onChange={e => setUserId(e.target.value)}>
                {staff.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
              </select>
            </div>
          </div>
          <div className="fg2" style={{ marginBottom: 10 }}>
            <div className="fg"><label className="fl">From Date</label><input className="fi" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
            <div className="fg"><label className="fl">To Date</label><input className="fi" type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="fl">Leave Type</label>
            <select className="fi" value={leaveType} onChange={e => setLeaveType(e.target.value)}>
              {LEAVE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" onClick={addLeave} disabled={busy}>＋ Add Leave</button>
        </div>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-title">📋 Leave Entries This Month</div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {!entries || entries.length === 0 ? (
              <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No leave entries for this month.</div>
            ) : entries.map(e => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <span>{e.user?.fullName || e.userId}</span>
                <span style={{ color: "var(--text-dim)" }}>{e.leaveType} · {e.fromDate?.slice(0, 10)} → {e.toDate?.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div>
        <div className="card">
          <div className="card-title">📊 Leave Summary — {monthKey}</div>
          {!entries || entries.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No leave entries this month.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(byStaff).map(([type, list]) => (
                <div key={type} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                  <span style={{ color: "var(--text-dim)" }}>{type}</span>
                  <strong>{list.length}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══ TAB: FLIGHT SCHEDULE ═════════════════════════════════════════════════════
function FlightScheduleTab({ stationId }) {
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [schedule, setSchedule] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState(null);

  const [year, month] = monthKey.split("-").map(Number);

  const load = useCallback(() => {
    if (!stationId) return;
    flightScheduleApi.getFlightSchedule(stationId, year, month).then(setSchedule).catch(err => setError(err.message));
  }, [stationId, year, month]);
  useEffect(load, [load]);

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
    <div className="two-col">
      <div>
        <div className="card">
          <div className="card-title">✈ Import Turn Report / Charter Schedule</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
            Upload the monthly Turn Report Excel export (Inbound/Outbound sheet, plus an optional Charter Flights sheet). Re-importing the same month replaces its previous data.
          </div>
          {error && <div className="ab red">{error}</div>}
          {importResult && <div className="ab green">✅ Imported: {importResult.turnRowCount} turn row(s), {importResult.charterRowCount} charter row(s)</div>}
          <div className="fg2" style={{ marginBottom: 10 }}>
            <div className="fg"><label className="fl">Target Month</label><input className="fi" type="month" value={monthKey} onChange={e => { setMonthKey(e.target.value); setImportResult(null); }} /></div>
            <div className="fg"><label className="fl">Excel File (.xlsx)</label><input className="fi" type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] || null)} /></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={doImport} disabled={busy}>{busy ? "Importing…" : "⬆ Import Schedule"}</button>
        </div>

        {schedule?.imported && (
          <div className="card">
            <div className="card-title">📊 Workload Summary — {monthKey}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
              <div>Operating days: <strong>{schedule.summary.operatingDays}</strong> / {schedule.summary.daysInMonth}</div>
              <div>Total movements: <strong>{schedule.summary.totalMovements}</strong></div>
              <div>Avg daily movements: <strong>{schedule.summary.avgDailyMovements}</strong></div>
              <div>Peak daily movements: <strong>{schedule.summary.peakDailyMovements}</strong> {schedule.summary.peakDate ? `(${schedule.summary.peakDate})` : ""}</div>
              <div>Turn rows: <strong>{schedule.summary.turnRowCount}</strong></div>
              <div>Charter rows: <strong>{schedule.summary.charterRowCount}</strong></div>
            </div>
          </div>
        )}
      </div>
      <div>
        <div className="card">
          <div className="card-title">📅 Day-by-Day Schedule — {monthKey}</div>
          {!schedule ? <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Loading…</div> : !schedule.imported ? (
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No flight schedule imported for this month yet.</div>
          ) : (
            <div className="wl-scroll" style={{ maxHeight: 520 }}>
              {Array.from({ length: schedule.daysInMonth }, (_, i) => i + 1).map(d => (
                <div key={d} style={{ borderBottom: "1px solid var(--border)", padding: "5px 0" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--cyan)" }}>Day {d}{!schedule.byDay[d]?.length ? " — no flights" : ""}</div>
                  {(schedule.byDay[d] || []).map((f, i) => (
                    <div key={i} style={{ fontSize: 9, color: "var(--text-dim)", display: "flex", justifyContent: "space-between", paddingLeft: 8 }}>
                      <span>{f.type === "Turn" ? "🔄" : "🛩"} {f.flightRef} <span style={{ color: "var(--text-dim)" }}>{f.route}</span></span>
                      <span>{f.arr !== "-" ? `Arr ${f.arr}` : ""} {f.dep !== "-" ? `Dep ${f.dep}` : ""} {f.ground !== "-" ? `GT ${f.ground}` : ""}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══ TAB 5: WORKLOAD INPUT ════════════════════════════════════════════════════
function WorkloadInputTab({ stationId }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aogBuffer, setAogBuffer] = useState(2);
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));

  const load = useCallback(() => {
    if (!stationId) return;
    planningApi.listWorkloadItems(stationId).then(setItems).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(load, [load]);

  async function save(item) {
    setBusy(true);
    setError("");
    try {
      await planningApi.upsertWorkloadItem({
        id: item.id, stationId, section: item.section, label: item.label,
        count: Number(item.count) || 0, b1: Number(item.b1) || 0, b2: Number(item.b2) || 0, cm: Number(item.cm) || 0, ncs: Number(item.ncs) || 0,
      });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function addRow(section) {
    setBusy(true);
    setError("");
    try {
      await planningApi.upsertWorkloadItem({ stationId, section, label: "New Item", count: 0, b1: 0, b2: 0, cm: 0, ncs: 0 });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function removeRow(id) {
    setBusy(true);
    setError("");
    try { await planningApi.deleteWorkloadItem(id); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function updateField(id, field, value) {
    setItems(list => list.map(it => (it.id === id ? { ...it, [field]: value } : it)));
  }

  if (!items) return <div className="card">Loading…</div>;

  return (
    <div className="two-col">
      <div>
        {WORKLOAD_SECTIONS.map(sec => (
          <div className="card" key={sec.key}>
            <div className="card-title">{sec.title}</div>
            <div className="wl-scroll">
              <div className="wl-row-hdr"><span>Label</span><span>{sec.countLabel}</span><span>B1</span><span>B2</span><span>CM</span><span>NCS</span><span></span></div>
              {items.filter(it => it.section === sec.key).map(it => (
                <div className="wl-row" key={it.id}>
                  <input className="fi" value={it.label} style={{ fontSize: 10 }} onChange={e => updateField(it.id, "label", e.target.value)} onBlur={() => save(items.find(x => x.id === it.id))} disabled={busy} />
                  <input className="fi" type="number" min="0" value={it.count} style={{ fontSize: 10, textAlign: "center" }} onChange={e => updateField(it.id, "count", e.target.value)} onBlur={() => save(items.find(x => x.id === it.id))} disabled={busy} />
                  <input className="fi" type="number" min="0" value={it.b1} style={{ fontSize: 10, textAlign: "center" }} onChange={e => updateField(it.id, "b1", e.target.value)} onBlur={() => save(items.find(x => x.id === it.id))} disabled={busy} />
                  <input className="fi" type="number" min="0" value={it.b2} style={{ fontSize: 10, textAlign: "center" }} onChange={e => updateField(it.id, "b2", e.target.value)} onBlur={() => save(items.find(x => x.id === it.id))} disabled={busy} />
                  <input className="fi" type="number" min="0" value={it.cm} style={{ fontSize: 10, textAlign: "center" }} onChange={e => updateField(it.id, "cm", e.target.value)} onBlur={() => save(items.find(x => x.id === it.id))} disabled={busy} />
                  <input className="fi" type="number" min="0" value={it.ncs} style={{ fontSize: 10, textAlign: "center" }} onChange={e => updateField(it.id, "ncs", e.target.value)} onBlur={() => save(items.find(x => x.id === it.id))} disabled={busy} />
                  <button className="wl-del" onClick={() => removeRow(it.id)} disabled={busy}>✕</button>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => addRow(sec.key)} disabled={busy}>＋ Add</button>
          </div>
        ))}
        {error && <div className="ab red">{error}</div>}
      </div>
      <div>
        <div className="card">
          <div className="card-title">📋 Availability Buffers</div>
          <div className="fg2">
            <div className="fg"><label className="fl">AOG buffer (extra staff)</label><input className="fi" type="number" min="0" value={aogBuffer} onChange={e => setAogBuffer(e.target.value)} /></div>
            <div className="fg"><label className="fl">Target Month</label><input className="fi" type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} /></div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">⚖️ Rules Applied</div>
          <div style={{ fontSize: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="ab green" style={{ margin: 0, padding: "5px 8px" }}>✅ 48h weekly rolling cap</div>
            <div className="ab green" style={{ margin: 0, padding: "5px 8px" }}>✅ N→M, A→M, N→A rest gaps</div>
            <div className="ab green" style={{ margin: 0, padding: "5px 8px" }}>✅ 2×Night → 2 OFF mandatory</div>
            <div className="ab green" style={{ margin: 0, padding: "5px 8px" }}>✅ Leave days auto-blocked</div>
            <div className="ab green" style={{ margin: 0, padding: "5px 8px" }}>✅ Expired qualifications blocked</div>
            <div className="ab green" style={{ margin: 0, padding: "5px 8px" }}>✅ Pattern-based rotation honoured</div>
            <div className="ab green" style={{ margin: 0, padding: "5px 8px" }}>✅ Min 1 B1 AME per shift (M/A/N)</div>
            <div className="ab green" style={{ margin: 0, padding: "5px 8px" }}>✅ Min 1 B2 AME on Night shift</div>
          </div>
        </div>
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-title">ℹ️ How Freq/month Tasks Are Calculated</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Enter the manpower needed for <strong>one occurrence</strong> of the task (per layover, per weekly check, per A-check, etc). Given the frequency/month, the engine works out how many can realistically fall on the same day (occurrences ÷ days in month, rounded up) and multiplies that by your per-task manpower to get the concurrent requirement used for shift coverage.
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══ TAB: WORKLOAD CONFIG ═════════════════════════════════════════════════════
const CATEGORIES = ["B1", "B2", "CM"];
const PREFERRED_SHIFT_OPTIONS = [{ value: "Any", label: "Any (split evenly)" }, { value: "M", label: "Morning" }, { value: "A", label: "Afternoon" }, { value: "N", label: "Night" }];

function WorkloadConfigTab({ stationId }) {
  const [config, setConfig] = useState(null);
  const [mandatory, setMandatory] = useState(null);
  const [plannedTasks, setPlannedTasks] = useState(null);
  const [unplannedTasks, setUnplannedTasks] = useState(null);
  const [manualDemand, setManualDemand] = useState(null);
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!stationId) return;
    workloadConfigApi.getConfig(stationId).then(setConfig).catch(err => setError(err.message));
    workloadConfigApi.listMandatoryCoverageRules(stationId).then(setMandatory).catch(err => setError(err.message));
    workloadConfigApi.listPlannedTasks(stationId).then(setPlannedTasks).catch(err => setError(err.message));
    workloadConfigApi.listUnplannedTasks(stationId).then(setUnplannedTasks).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!stationId) return;
    workloadConfigApi.listManualDemand(stationId, monthKey).then(setManualDemand).catch(err => setError(err.message));
  }, [stationId, monthKey]);

  const NUMERIC_CONFIG_FIELDS = [
    "transitMinutesDefault", "pdcMinutesBeforeDeparture", "clashProximityMinutes", "transitVsPdcThresholdMinutes",
    "movementsPerB1Staff", "movementsPerCMStaff", "movementsPerNCSStaff",
    "unplannedManpowerHoursPerMonth", "unplannedBufferPct", "bufferB1", "bufferB2", "bufferCM", "bufferNCS",
  ];
  async function saveConfig() {
    setBusy(true);
    setError("");
    try {
      // Number inputs report their value as a string via onChange — every
      // numeric field must be coerced back before it hits the API's
      // z.number() schema, the same convention every other tab in this
      // wizard follows in its own save().
      const payload = { stationId, unplannedMethod: config.unplannedMethod };
      NUMERIC_CONFIG_FIELDS.forEach(f => { payload[f] = Number(config[f]) || 0; });
      await workloadConfigApi.upsertConfig(payload);
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function saveMandatory(row) {
    setBusy(true);
    setError("");
    try {
      await workloadConfigApi.upsertMandatoryCoverageRule({ stationId, category: row.category, shift: row.shift, enabled: row.enabled, minCount: Number(row.minCount) || 1 });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function savePlannedTask(t) {
    setBusy(true);
    setError("");
    try {
      await workloadConfigApi.upsertPlannedTask({
        id: t.id, stationId, name: t.name, frequency: Number(t.frequency) || 0, frequencyUnit: t.frequencyUnit,
        avgDurationMin: Number(t.avgDurationMin) || 0, reqB1: Number(t.reqB1) || 0, reqB2: Number(t.reqB2) || 0,
        reqCM: Number(t.reqCM) || 0, reqNCS: Number(t.reqNCS) || 0, preferredShift: t.preferredShift || "Any",
      });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function addPlannedTask() {
    setBusy(true); setError("");
    try { await workloadConfigApi.upsertPlannedTask({ stationId, name: "New Task", frequency: 0, frequencyUnit: "per_month", avgDurationMin: 0, reqB1: 0, reqB2: 0, reqCM: 0, reqNCS: 0, preferredShift: "Any" }); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function removePlannedTask(id) {
    setBusy(true); setError("");
    try { await workloadConfigApi.deletePlannedTask(id); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function saveUnplannedTask(t) {
    setBusy(true);
    setError("");
    try {
      await workloadConfigApi.upsertUnplannedTask({
        id: t.id, stationId, name: t.name, avgFreqPerMonth: Number(t.avgFreqPerMonth) || 0,
        avgDurationMin: Number(t.avgDurationMin) || 0, reqB1: Number(t.reqB1) || 0, reqB2: Number(t.reqB2) || 0,
        reqCM: Number(t.reqCM) || 0, reqNCS: Number(t.reqNCS) || 0, preferredShift: t.preferredShift || "Any",
      });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function addUnplannedTask() {
    setBusy(true); setError("");
    try { await workloadConfigApi.upsertUnplannedTask({ stationId, name: "New Task", avgFreqPerMonth: 0, avgDurationMin: 0, reqB1: 0, reqB2: 0, reqCM: 0, reqNCS: 0, preferredShift: "Any" }); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function removeUnplannedTask(id) {
    setBusy(true); setError("");
    try { await workloadConfigApi.deleteUnplannedTask(id); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const [demandForm, setDemandForm] = useState({ date: "", timeStart: "", timeEnd: "", reqB1: 0, reqB2: 0, reqCM: 0, reqNCS: 0, remarks: "" });
  async function addManualDemand() {
    if (!demandForm.date) { setError("Date is required"); return; }
    setBusy(true); setError("");
    try {
      await workloadConfigApi.createManualDemand({ stationId, ...demandForm, reqB1: Number(demandForm.reqB1) || 0, reqB2: Number(demandForm.reqB2) || 0, reqCM: Number(demandForm.reqCM) || 0, reqNCS: Number(demandForm.reqNCS) || 0 });
      setDemandForm({ date: "", timeStart: "", timeEnd: "", reqB1: 0, reqB2: 0, reqCM: 0, reqNCS: 0, remarks: "" });
      workloadConfigApi.listManualDemand(stationId, monthKey).then(setManualDemand);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function removeManualDemand(id) {
    setBusy(true); setError("");
    try { await workloadConfigApi.deleteManualDemand(id); workloadConfigApi.listManualDemand(stationId, monthKey).then(setManualDemand); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!config || !mandatory || !plannedTasks || !unplannedTasks) return <div className="card">Loading…</div>;

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <div className="card-title">⚙ Standard Durations & Ratios</div>
          {error && <div className="ab red">{error}</div>}
          <div className="fg2">
            <div className="fg"><label className="fl">Transit fallback (min)</label><input className="fi" type="number" value={config.transitMinutesDefault} onChange={e => setConfig(c => ({ ...c, transitMinutesDefault: e.target.value }))} /></div>
            <div className="fg"><label className="fl">PDC duration (min before dep)</label><input className="fi" type="number" value={config.pdcMinutesBeforeDeparture} onChange={e => setConfig(c => ({ ...c, pdcMinutesBeforeDeparture: e.target.value }))} /></div>
            <div className="fg"><label className="fl">Clash Proximity Threshold (min)</label><input className="fi" type="number" value={config.clashProximityMinutes} onChange={e => setConfig(c => ({ ...c, clashProximityMinutes: e.target.value }))} /></div>
            <div className="fg"><label className="fl">Transit vs PDC threshold (min)</label><input className="fi" type="number" value={config.transitVsPdcThresholdMinutes} onChange={e => setConfig(c => ({ ...c, transitVsPdcThresholdMinutes: e.target.value }))} /></div>
            <div className="fg"><label className="fl">Movements per B1 staff</label><input className="fi" type="number" min="1" value={config.movementsPerB1Staff} onChange={e => setConfig(c => ({ ...c, movementsPerB1Staff: e.target.value }))} /></div>
            <div className="fg"><label className="fl">Movements per CM staff</label><input className="fi" type="number" min="1" value={config.movementsPerCMStaff} onChange={e => setConfig(c => ({ ...c, movementsPerCMStaff: e.target.value }))} /></div>
            <div className="fg"><label className="fl">Movements per NCS staff</label><input className="fi" type="number" min="1" value={config.movementsPerNCSStaff} onChange={e => setConfig(c => ({ ...c, movementsPerNCSStaff: e.target.value }))} /></div>
            <div className="fg"><label className="fl">Unplanned method</label>
              <select className="fi" value={config.unplannedMethod} onChange={e => setConfig(c => ({ ...c, unplannedMethod: e.target.value }))}>
                <option value="frequency">Frequency-based (Unplanned Task Master)</option>
                <option value="manpower_hours">Flat manpower-hours allowance</option>
                <option value="both">Both (summed)</option>
              </select>
            </div>
            <div className="fg"><label className="fl">Unplanned manpower-hrs/month</label><input className="fi" type="number" value={config.unplannedManpowerHoursPerMonth} onChange={e => setConfig(c => ({ ...c, unplannedManpowerHoursPerMonth: e.target.value }))} /></div>
            <div className="fg"><label className="fl">Unplanned buffer %</label><input className="fi" type="number" value={config.unplannedBufferPct} onChange={e => setConfig(c => ({ ...c, unplannedBufferPct: e.target.value }))} /></div>
          </div>
          <div className="card-title" style={{ marginTop: 10 }}>Per-Shift Unplanned Buffer</div>
          <div className="fg2">
            {["B1", "B2", "CM", "NCS"].map(cat => (
              <div className="fg" key={cat}><label className="fl">{cat}</label><input className="fi" type="number" min="0" value={config[`buffer${cat}`]} onChange={e => setConfig(c => ({ ...c, [`buffer${cat}`]: e.target.value }))} /></div>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={saveConfig} disabled={busy}>💾 Save Config</button>
        </div>

        <div className="card">
          <div className="card-title">🛡 Mandatory Minimum Coverage</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8 }}>A non-negotiable floor — separate from workload-driven advisory sizing. Unmet mandatory coverage is reported as a critical violation.</div>
          <table className="rt" style={{ width: "100%" }}>
            <thead><tr><th style={{ textAlign: "left", paddingLeft: 9 }}>Category</th><th>Morning</th><th>Afternoon</th><th>Night</th></tr></thead>
            <tbody>
              {CATEGORIES.map(cat => (
                <tr key={cat}>
                  <td style={{ textAlign: "left", paddingLeft: 9 }}><span className={`cat-tag cat-${cat}`}>{cat}</span></td>
                  {["M", "A", "N"].map(sh => {
                    const row = mandatory.find(m => m.category === cat && m.shift === sh);
                    return (
                      <td key={sh} style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={row.enabled} disabled={busy}
                          onChange={e => saveMandatory({ ...row, enabled: e.target.checked })} />
                        <input className="fi" type="number" min="1" style={{ width: 44, marginLeft: 4, display: "inline-block", fontSize: 10 }} value={row.minCount} disabled={busy || !row.enabled}
                          onChange={e => setMandatory(list => list.map(m => (m === row ? { ...m, minCount: e.target.value } : m)))}
                          onBlur={e => saveMandatory({ ...row, minCount: e.target.value })} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="card">
          <div className="card-title">🔧 Planned Task Master</div>
          <div className="wl-scroll">
            {plannedTasks.map(t => (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 70px 90px 70px 40px 40px 40px 40px 90px 28px", gap: 4, marginBottom: 5, alignItems: "center" }}>
                <input className="fi" value={t.name} style={{ fontSize: 9 }} onChange={e => setPlannedTasks(l => l.map(x => (x.id === t.id ? { ...x, name: e.target.value } : x)))} onBlur={() => savePlannedTask(plannedTasks.find(x => x.id === t.id))} disabled={busy} />
                <input className="fi" type="number" min="0" title="Frequency" value={t.frequency} style={{ fontSize: 9 }} onChange={e => setPlannedTasks(l => l.map(x => (x.id === t.id ? { ...x, frequency: e.target.value } : x)))} onBlur={() => savePlannedTask(plannedTasks.find(x => x.id === t.id))} disabled={busy} />
                <select className="fi" value={t.frequencyUnit} style={{ fontSize: 9 }} onChange={e => { setPlannedTasks(l => l.map(x => (x.id === t.id ? { ...x, frequencyUnit: e.target.value } : x))); savePlannedTask({ ...t, frequencyUnit: e.target.value }); }} disabled={busy}>
                  <option value="per_month">/month</option><option value="per_week">/week</option><option value="per_operating_day">/op-day</option>
                </select>
                <input className="fi" type="number" min="0" title="Avg duration (min)" value={t.avgDurationMin} style={{ fontSize: 9 }} onChange={e => setPlannedTasks(l => l.map(x => (x.id === t.id ? { ...x, avgDurationMin: e.target.value } : x)))} onBlur={() => savePlannedTask(plannedTasks.find(x => x.id === t.id))} disabled={busy} />
                {["reqB1", "reqB2", "reqCM", "reqNCS"].map(f => (
                  <input key={f} className="fi" type="number" min="0" title={f} value={t[f]} style={{ fontSize: 9, textAlign: "center" }} onChange={e => setPlannedTasks(l => l.map(x => (x.id === t.id ? { ...x, [f]: e.target.value } : x)))} onBlur={() => savePlannedTask(plannedTasks.find(x => x.id === t.id))} disabled={busy} />
                ))}
                <select className="fi" value={t.preferredShift || "Any"} style={{ fontSize: 9 }} onChange={e => { setPlannedTasks(l => l.map(x => (x.id === t.id ? { ...x, preferredShift: e.target.value } : x))); savePlannedTask({ ...t, preferredShift: e.target.value }); }} disabled={busy}>
                  {PREFERRED_SHIFT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button className="wl-del" onClick={() => removePlannedTask(t.id)} disabled={busy}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addPlannedTask} disabled={busy}>＋ Add Planned Task</button>
        </div>

        <div className="card">
          <div className="card-title">🛠 Unplanned Task Master</div>
          <div className="wl-scroll">
            {unplannedTasks.map(t => (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 90px 90px 40px 40px 40px 40px 90px 28px", gap: 4, marginBottom: 5, alignItems: "center" }}>
                <input className="fi" value={t.name} style={{ fontSize: 9 }} onChange={e => setUnplannedTasks(l => l.map(x => (x.id === t.id ? { ...x, name: e.target.value } : x)))} onBlur={() => saveUnplannedTask(unplannedTasks.find(x => x.id === t.id))} disabled={busy} />
                <input className="fi" type="number" min="0" title="Avg freq/month" value={t.avgFreqPerMonth} style={{ fontSize: 9 }} onChange={e => setUnplannedTasks(l => l.map(x => (x.id === t.id ? { ...x, avgFreqPerMonth: e.target.value } : x)))} onBlur={() => saveUnplannedTask(unplannedTasks.find(x => x.id === t.id))} disabled={busy} />
                <input className="fi" type="number" min="0" title="Avg duration (min)" value={t.avgDurationMin} style={{ fontSize: 9 }} onChange={e => setUnplannedTasks(l => l.map(x => (x.id === t.id ? { ...x, avgDurationMin: e.target.value } : x)))} onBlur={() => saveUnplannedTask(unplannedTasks.find(x => x.id === t.id))} disabled={busy} />
                {["reqB1", "reqB2", "reqCM", "reqNCS"].map(f => (
                  <input key={f} className="fi" type="number" min="0" title={f} value={t[f]} style={{ fontSize: 9, textAlign: "center" }} onChange={e => setUnplannedTasks(l => l.map(x => (x.id === t.id ? { ...x, [f]: e.target.value } : x)))} onBlur={() => saveUnplannedTask(unplannedTasks.find(x => x.id === t.id))} disabled={busy} />
                ))}
                <select className="fi" value={t.preferredShift || "Any"} style={{ fontSize: 9 }} onChange={e => { setUnplannedTasks(l => l.map(x => (x.id === t.id ? { ...x, preferredShift: e.target.value } : x))); saveUnplannedTask({ ...t, preferredShift: e.target.value }); }} disabled={busy}>
                  {PREFERRED_SHIFT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button className="wl-del" onClick={() => removeUnplannedTask(t.id)} disabled={busy}>✕</button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addUnplannedTask} disabled={busy}>＋ Add Unplanned Task</button>
        </div>

        <div className="card">
          <div className="card-title">📋 Manual Additional Demand</div>
          <div className="fg" style={{ marginBottom: 8 }}><label className="fl">Month</label><input className="fi" type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 70px 70px 40px 40px 40px 40px 1fr", gap: 4, marginBottom: 6 }}>
            <input className="fi" type="date" style={{ fontSize: 9 }} value={demandForm.date} onChange={e => setDemandForm(f => ({ ...f, date: e.target.value }))} />
            <input className="fi" type="time" style={{ fontSize: 9 }} value={demandForm.timeStart} onChange={e => setDemandForm(f => ({ ...f, timeStart: e.target.value }))} />
            <input className="fi" type="time" style={{ fontSize: 9 }} value={demandForm.timeEnd} onChange={e => setDemandForm(f => ({ ...f, timeEnd: e.target.value }))} />
            {["reqB1", "reqB2", "reqCM", "reqNCS"].map(f => (
              <input key={f} className="fi" type="number" min="0" title={f} style={{ fontSize: 9, textAlign: "center" }} value={demandForm[f]} onChange={e => setDemandForm(v => ({ ...v, [f]: e.target.value }))} />
            ))}
            <input className="fi" placeholder="Remarks" style={{ fontSize: 9 }} value={demandForm.remarks} onChange={e => setDemandForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={addManualDemand} disabled={busy}>＋ Add Demand Entry</button>
          <div className="wl-scroll" style={{ marginTop: 8 }}>
            {(manualDemand || []).map(m => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span>{m.date?.slice(0, 10)} {m.timeStart || ""}{m.timeEnd ? `–${m.timeEnd}` : ""} — B1:{m.reqB1} B2:{m.reqB2} CM:{m.reqCM} NCS:{m.reqNCS} {m.remarks && `(${m.remarks})`}</span>
                <button className="wl-del" onClick={() => removeManualDemand(m.id)} disabled={busy}>✕</button>
              </div>
            ))}
            {(!manualDemand || manualDemand.length === 0) && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No manual demand entries this month.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══ TAB: RULE BUILDER ════════════════════════════════════════════════════════
const HARD_CONDITION_TYPES = [
  "max_consecutive_nights", "rest_after_night", "min_rest_hours", "forced_off_after_nights",
  "max_weekly_hours", "max_monthly_hours", "night_only", "no_night",
];
const SOFT_CONDITION_TYPES = ["balance_total_hours", "balance_night_duties"];

function RuleBuilderTab({ stationId }) {
  const [groups, setGroups] = useState(null);
  const [rules, setRules] = useState(null);
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newGroupName, setNewGroupName] = useState("");

  const load = useCallback(() => {
    if (!stationId) return;
    ruleBuilderApi.listStaffGroups(stationId).then(setGroups).catch(err => setError(err.message));
    ruleBuilderApi.listRules(stationId).then(setRules).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!stationId) return;
    staffApi.listStaff({ stationId, pageSize: 500 }).then(r => setStaff(r.items || r)).catch(() => {});
  }, [stationId]);

  async function addGroup() {
    if (!newGroupName.trim()) return;
    setBusy(true); setError("");
    try { await ruleBuilderApi.upsertStaffGroup({ stationId, name: newGroupName.trim(), memberUserIds: [] }); setNewGroupName(""); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function toggleMember(group, userId) {
    const memberUserIds = group.members.some(m => m.userId === userId) ? group.members.filter(m => m.userId !== userId).map(m => m.userId) : [...group.members.map(m => m.userId), userId];
    setBusy(true); setError("");
    try { await ruleBuilderApi.upsertStaffGroup({ id: group.id, stationId, name: group.name, memberUserIds }); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function removeGroup(id) {
    setBusy(true); setError("");
    try { await ruleBuilderApi.deleteStaffGroup(id); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function saveRule(r) {
    setBusy(true); setError("");
    try {
      await ruleBuilderApi.upsertRule({
        id: r.id, stationId, name: r.name, appliesToType: r.appliesToType, appliesToValue: r.appliesToValue || null,
        conditionType: r.conditionType, limitValue: r.limitValue === "" ? null : Number(r.limitValue),
        offDays: r.offDays === "" ? null : Number(r.offDays), priority: r.priority, type: r.type, enabled: r.enabled,
      });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function addRule(type) {
    setBusy(true); setError("");
    try {
      await ruleBuilderApi.upsertRule({
        stationId, name: type === "hard" ? "New Hard Rule" : "New Soft Rule", appliesToType: "all",
        conditionType: type === "hard" ? "max_consecutive_nights" : "balance_total_hours",
        limitValue: type === "hard" ? 2 : null, priority: "Medium", type, enabled: true,
      });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function removeRule(id) {
    setBusy(true); setError("");
    try { await ruleBuilderApi.deleteRule(id); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!groups || !rules) return <div className="card">Loading…</div>;

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <div className="card-title">👥 Staff Groups</div>
          {error && <div className="ab red">{error}</div>}
          <div className="fg2" style={{ marginBottom: 8 }}>
            <input className="fi" placeholder="New group name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
            <button className="btn btn-ghost btn-sm" onClick={addGroup} disabled={busy}>＋ Add Group</button>
          </div>
          {groups.map(g => (
            <div key={g.id} style={{ marginBottom: 10, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                <span>{g.name} ({g.members.length})</span>
                <button className="wl-del" onClick={() => removeGroup(g.id)} disabled={busy}>✕</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 100, overflowY: "auto" }}>
                {staff.map(s => (
                  <label key={s.id} style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3 }}>
                    <input type="checkbox" checked={g.members.some(m => m.userId === s.id)} onChange={() => toggleMember(g, s.id)} disabled={busy} />
                    {s.fullName}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="card">
          <div className="card-title">🔒 Hard Rules (enforced during generation)</div>
          {rules.filter(r => r.type === "hard").map(r => (
            <RuleRow key={r.id} rule={r} groups={groups} conditionTypes={HARD_CONDITION_TYPES} onSave={saveRule} onDelete={removeRule} busy={busy} setRules={setRules} rules={rules} />
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => addRule("hard")} disabled={busy}>＋ Add Hard Rule</button>
        </div>
        <div className="card">
          <div className="card-title">⚖ Soft Rules (scored only)</div>
          {rules.filter(r => r.type === "soft").map(r => (
            <RuleRow key={r.id} rule={r} groups={groups} conditionTypes={SOFT_CONDITION_TYPES} onSave={saveRule} onDelete={removeRule} busy={busy} setRules={setRules} rules={rules} />
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => addRule("soft")} disabled={busy}>＋ Add Soft Rule</button>
        </div>
      </div>
    </div>
  );
}

function RuleRow({ rule: r, groups, conditionTypes, onSave, onDelete, busy, setRules, rules }) {
  function update(field, value) { setRules(list => list.map(x => (x.id === r.id ? { ...x, [field]: value } : x))); }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 90px 90px 130px 50px 50px 80px 40px 28px", gap: 4, marginBottom: 5, alignItems: "center" }}>
      <input className="fi" value={r.name} style={{ fontSize: 9 }} onChange={e => update("name", e.target.value)} onBlur={() => onSave(rules.find(x => x.id === r.id))} disabled={busy} />
      <select className="fi" value={r.appliesToType} style={{ fontSize: 9 }} onChange={e => { update("appliesToType", e.target.value); onSave({ ...r, appliesToType: e.target.value }); }} disabled={busy}>
        <option value="all">All Staff</option><option value="category">Category</option><option value="group">Group</option><option value="staff">Staff</option>
      </select>
      {r.appliesToType === "category" ? (
        <select className="fi" value={r.appliesToValue || ""} style={{ fontSize: 9 }} onChange={e => { update("appliesToValue", e.target.value); onSave({ ...r, appliesToValue: e.target.value }); }} disabled={busy}>
          {CATEGORIES.concat("NCS").map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : r.appliesToType === "group" ? (
        <select className="fi" value={r.appliesToValue || ""} style={{ fontSize: 9 }} onChange={e => { update("appliesToValue", e.target.value); onSave({ ...r, appliesToValue: e.target.value }); }} disabled={busy}>
          <option value="">—</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      ) : <span style={{ fontSize: 9, color: "var(--text-dim)" }}>{r.appliesToType === "staff" ? r.appliesToValue : "—"}</span>}
      <select className="fi" value={r.conditionType} style={{ fontSize: 9 }} onChange={e => { update("conditionType", e.target.value); onSave({ ...r, conditionType: e.target.value }); }} disabled={busy}>
        {conditionTypes.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <input className="fi" type="number" placeholder="limit" title="limitValue" style={{ fontSize: 9 }} value={r.limitValue ?? ""} onChange={e => update("limitValue", e.target.value)} onBlur={() => onSave(rules.find(x => x.id === r.id))} disabled={busy} />
      <input className="fi" type="number" placeholder="offDays" title="offDays" style={{ fontSize: 9 }} value={r.offDays ?? ""} onChange={e => update("offDays", e.target.value)} onBlur={() => onSave(rules.find(x => x.id === r.id))} disabled={busy} />
      <select className="fi" value={r.priority} style={{ fontSize: 9 }} onChange={e => { update("priority", e.target.value); onSave({ ...r, priority: e.target.value }); }} disabled={busy}>
        <option>High</option><option>Medium</option><option>Low</option>
      </select>
      <label style={{ fontSize: 9 }}><input type="checkbox" checked={r.enabled} onChange={e => { update("enabled", e.target.checked); onSave({ ...r, enabled: e.target.checked }); }} disabled={busy} /></label>
      <button className="wl-del" onClick={() => onDelete(r.id)} disabled={busy}>✕</button>
    </div>
  );
}

// ═══ TAB: DAILY OPERATIONAL ADJUSTMENT ════════════════════════════════════════
function DailyOpsTab({ stationId }) {
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [entries, setEntries] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [form, setForm] = useState({ date: "", description: "", reqB1: 0, reqB2: 0, reqCM: 0, reqNCS: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!stationId) return;
    dailyOpsApi.listAdjustments(stationId, monthKey).then(setEntries).catch(err => setError(err.message));
    dailyOpsApi.getComparison(stationId, monthKey).then(setComparison).catch(err => setError(err.message));
  }, [stationId, monthKey]);
  useEffect(load, [load]);

  async function add() {
    if (!form.date || !form.description.trim()) { setError("Date and description are required"); return; }
    setBusy(true); setError("");
    try {
      await dailyOpsApi.createAdjustment({ stationId, ...form, reqB1: Number(form.reqB1) || 0, reqB2: Number(form.reqB2) || 0, reqCM: Number(form.reqCM) || 0, reqNCS: Number(form.reqNCS) || 0 });
      setForm({ date: "", description: "", reqB1: 0, reqB2: 0, reqCM: 0, reqNCS: 0 });
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function remove(id) {
    setBusy(true); setError("");
    try { await dailyOpsApi.deleteAdjustment(id); load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const STATUS_COLOR = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" };
  const STATUS_ICON = { green: "✅", amber: "⚠", red: "🛑" };

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <div className="card-title">📅 Log Daily Operational Adjustment</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
            Records near-term operational reality as it becomes known — this NEVER auto-changes the published roster, it only informs the comparison view.
          </div>
          {error && <div className="ab red">{error}</div>}
          <div className="fg2" style={{ marginBottom: 8 }}>
            <div className="fg"><label className="fl">Date</label><input className="fi" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div className="fg"><label className="fl">Description</label><input className="fi" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <div className="fg2" style={{ marginBottom: 8 }}>
            {["reqB1", "reqB2", "reqCM", "reqNCS"].map(f => (
              <div className="fg" key={f}><label className="fl">{f.replace("req", "")}</label><input className="fi" type="number" min="0" value={form[f]} onChange={e => setForm(v => ({ ...v, [f]: e.target.value }))} /></div>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" onClick={add} disabled={busy}>＋ Log Adjustment</button>
        </div>
        <div className="card">
          <div className="card-title">📋 Entries — {monthKey}</div>
          <div className="fg" style={{ marginBottom: 8 }}><label className="fl">Month</label><input className="fi" type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} /></div>
          <div className="wl-scroll">
            {(entries || []).map(e => (
              <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span>{e.date?.slice(0, 10)} — {e.description} (B1:{e.reqB1} B2:{e.reqB2} CM:{e.reqCM} NCS:{e.reqNCS})</span>
                <button className="wl-del" onClick={() => remove(e.id)} disabled={busy}>✕</button>
              </div>
            ))}
            {(!entries || entries.length === 0) && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No entries this month.</div>}
          </div>
        </div>
      </div>
      <div>
        <div className="card">
          <div className="card-title">🚦 Comparison vs Rostered Coverage</div>
          {!comparison || comparison.length === 0 ? (
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No entries to compare this month.</div>
          ) : comparison.map(c => (
            <div key={c.id} style={{ marginBottom: 10, borderLeft: `3px solid ${STATUS_COLOR[c.overallStatus]}`, paddingLeft: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{STATUS_ICON[c.overallStatus]} {c.date?.slice(0, 10)} — {c.description}</div>
              <div style={{ display: "flex", gap: 10, fontSize: 9, marginTop: 3 }}>
                {c.byCategory.map(bc => (
                  <span key={bc.category} style={{ color: STATUS_COLOR[bc.status] }}>{bc.category}: {bc.rostered}/{bc.required}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══ TAB 6: GENERATE ══════════════════════════════════════════════════════════
function GenerateTab({ stationId }) {
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [usePatterns, setUsePatterns] = useState(true);
  const [applyLeave, setApplyLeave] = useState(true);
  const [continueFromPrevious, setContinueFromPrevious] = useState(true);
  const [aogBuffer, setAogBuffer] = useState(2);
  const [plan, setPlan] = useState(null);
  const [preview, setPreview] = useState(null);
  const [applied, setApplied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function calculate() {
    setBusy(true);
    setError("");
    setApplied(null);
    try {
      const [planResult, previewResult] = await Promise.all([
        planningApi.getManpowerPlan(stationId, monthKey, aogBuffer),
        rosterApi.generateRoster(stationId, monthKey, { preview: true, continueFromPrevious, usePatterns, applyLeave }),
      ]);
      setPlan(planResult);
      setPreview(previewResult);
    } catch (err) { setError(err.message); setPlan(null); setPreview(null); } finally { setBusy(false); }
  }

  async function apply() {
    if (preview?.existingRosterExists) {
      if (!confirm(`A roster already exists for ${monthKey} (may include manual edits).\n\nApplying now will REPLACE it with this newly generated roster. This cannot be undone.\n\nContinue?`)) return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await rosterApi.generateRoster(stationId, monthKey, { continueFromPrevious, usePatterns, applyLeave });
      setApplied(result);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  function exportPlan() {
    if (!plan) return;
    const rows = [["Shift", "B1 Required", "B2 Required", "CM Required", "NCS Required", "AOG Buffer", "Total Needed"]];
    for (const sh of ["M", "A", "N"]) {
      rows.push([SHIFT_LABELS[sh], plan.peak[sh].b1, plan.peak[sh].b2, plan.peak[sh].cm, plan.peak[sh].ncs, plan.aogPerShift, plan.target[sh]]);
    }
    rows.push([]);
    rows.push(["Effective available", plan.effectiveStaff]);
    rows.push(["Peak daily need (all shifts)", plan.grandNeeded]);
    const csv = rows.map(r => r.map(v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `RosterPro_ManpowerPlan_${monthKey}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <div className="card-title">🤖 Generate Roster</div>
          <div className="fg2" style={{ marginBottom: 12 }}>
            <div className="fg"><label className="fl">Target Month</label><input className="fi" type="month" value={monthKey} onChange={e => { setMonthKey(e.target.value); setPlan(null); setPreview(null); setApplied(null); }} /></div>
            <div className="fg"><label className="fl">Use defined patterns?</label>
              <select className="fi" value={usePatterns ? "1" : "0"} onChange={e => setUsePatterns(e.target.value === "1")}>
                <option value="1">Yes — follow staff pattern assignments</option>
                <option value="0">No — auto-distribute by workload only</option>
              </select>
            </div>
            <div className="fg"><label className="fl">Apply leave entries?</label>
              <select className="fi" value={applyLeave ? "1" : "0"} onChange={e => setApplyLeave(e.target.value === "1")}>
                <option value="1">Yes — block leave days automatically</option>
                <option value="0">No — ignore leave entries</option>
              </select>
            </div>
            <div className="fg">
              <label className="fl">Continue from Previous Roster? <span className="help-tip" tabIndex={0} title="ON: looks at how each staff member's PREVIOUS month ended (their last 2-3 shifts) and continues the rotation from there. OFF: every staff member starts fresh from day 1.">ⓘ</span></label>
              <select className="fi" value={continueFromPrevious ? "1" : "0"} onChange={e => setContinueFromPrevious(e.target.value === "1")}>
                <option value="1">Yes — continue rotation & rest rules from last month (recommended)</option>
                <option value="0">No — start a completely new cycle</option>
              </select>
            </div>
            <div className="fg"><label className="fl">AOG Buffer</label><input className="fi" type="number" min="0" value={aogBuffer} onChange={e => setAogBuffer(e.target.value)} /></div>
          </div>
          <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: 12, fontSize: 13 }} onClick={calculate} disabled={busy}>
            {busy ? "Calculating…" : "🤖 Calculate & Generate Roster"}
          </button>
        </div>

        {error && <div className="ab red">{error}</div>}

        {plan && (
          <>
            <div className={`ab ${plan.sufficient ? "green" : "red"}`}>
              {plan.sufficient ? "✅" : "⚠"} Peak daily need: <strong>{plan.grandNeeded}</strong> · Available: <strong>{plan.effectiveStaff}</strong> · {plan.sufficient ? "Sufficient coverage" : `⚠ Shortfall of ${plan.shortfall} staff`}
            </div>
            <div className="result-box">
              <div className="result-title" style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>📊 Manpower Requirement — {monthKey}</div>
              <div className="manpower-grid">
                {["M", "A", "N"].map(sh => (
                  <div className="mp-card" key={sh}>
                    <div className="mp-shift" style={{ fontSize: 10, color: "var(--text-dim)" }}>{SHIFT_LABELS[sh]}</div>
                    <div className="mp-total" style={{ fontSize: 20, fontWeight: 800 }}>{plan.target[sh]}</div>
                    <div className="mp-breakdown" style={{ fontSize: 9, color: "var(--text-dim)" }}>B1:{plan.peak[sh].b1} · B2:{plan.peak[sh].b2} · CM:{plan.peak[sh].cm} · NCS:{plan.peak[sh].ncs}</div>
                  </div>
                ))}
              </div>
            </div>
            {preview && (
              <div className="card" style={{ borderColor: preview.violations.length ? "var(--amber)" : "var(--rp-green)" }}>
                <div className="card-title">{preview.violations.length ? `⚠️ ${preview.violations.length} Critical Coverage Gaps in Generated Roster` : "✅ Generated Roster: Full Mandatory Coverage"}</div>
                <div style={{ fontSize: 11 }}>{preview.staffCount} staff · {preview.blockedCount} blocked · {preview.assignmentCount} shifts to assign{preview.advisoryGaps?.length ? ` · ${preview.advisoryGaps.length} advisory gap(s)` : ""}</div>
              </div>
            )}

            {preview?.analysis && (
              <div className="card">
                <div className="card-title">📈 Explainable Workload Analysis</div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", marginBottom: 8 }}>
                  Demand source: <strong style={{ color: preview.analysis.demandSource === "flight-schedule-driven" ? "var(--green)" : "var(--text-dim)" }}>{preview.analysis.demandSource}</strong> — {preview.analysis.demandReason}
                </div>
                <div className="manpower-grid">
                  {["M", "A", "N"].map(sh => {
                    const em = preview.analysis.explainableManpower[sh];
                    return (
                      <div className="mp-card" key={sh}>
                        <div className="mp-shift" style={{ fontSize: 10, color: "var(--text-dim)" }}>{SHIFT_LABELS[sh]}</div>
                        <div className="mp-total" style={{ fontSize: 18, fontWeight: 800 }}>{em.required}</div>
                        <div className="mp-breakdown" style={{ fontSize: 9, color: "var(--text-dim)" }}>Flight/PDC:{em.flightPdcDemand} · Planned:{em.plannedMaintenance} · Unplanned:{em.unplannedReserve}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {preview?.analysis && (
              <div className="card">
                <div className="card-title">⚖ Soft Rule Optimization Score</div>
                {preview.analysis.softRuleScore.overallScore === null ? (
                  <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No soft (balance) rules configured yet — see Rule Builder.</div>
                ) : (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "var(--cyan)" }}>{preview.analysis.softRuleScore.overallScore}<span style={{ fontSize: 11, color: "var(--text-dim)" }}> / 100</span></div>
                    {preview.analysis.softRuleScore.results.map((r, i) => (
                      <div key={i} style={{ fontSize: 10, display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                        <span>{r.ruleName} ({r.metric}, {r.appliesTo})</span><strong>{r.score}</strong>
                      </div>
                    ))}
                  </>
                )}
                {preview.analysis.hardRuleViolations.length > 0 && (
                  <div className="ab red" style={{ marginTop: 8 }}>⚠ {preview.analysis.hardRuleViolations.length} hard rule violation(s) detected</div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
              <button className="btn btn-primary" onClick={apply} disabled={busy}>{busy ? "Applying…" : "✅ Apply → Open Shift Roster"}</button>
              <button className="btn btn-ghost" onClick={exportPlan}>⬇ Export Plan</button>
            </div>
          </>
        )}

        {applied && (
          <div className="card" style={{ borderColor: "var(--rp-green)", marginTop: 12 }}>
            <div className="card-title">✅ Applied — {monthKey} Roster Saved</div>
            <div style={{ fontSize: 11 }}>{applied.staffCount} staff, {applied.assignmentCount} shifts assigned, {applied.violations.length} critical coverage gap(s){applied.advisoryGaps?.length ? `, ${applied.advisoryGaps.length} advisory gap(s)` : ""} remaining. Open <strong>Shift Roster</strong> to review or hand-edit individual cells, then Publish when ready.</div>
          </div>
        )}
      </div>
      <div>
        <div className="card">
          <div className="card-title">👥 Category Requirement</div>
          {!plan ? <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Run generation to see results</div> : (
            <table style={{ width: "100%", fontSize: 10 }}>
              <thead><tr>
                <th style={{ textAlign: "left", padding: "3px 5px", background: "var(--navy-lite)" }}>Cat</th>
                <th style={{ padding: "3px 5px", background: "var(--navy-lite)" }}>Morning</th>
                <th style={{ padding: "3px 5px", background: "var(--navy-lite)" }}>Afternoon</th>
                <th style={{ padding: "3px 5px", background: "var(--navy-lite)" }}>Night</th>
                <th style={{ padding: "3px 5px", background: "var(--navy-lite)" }}>Available</th>
                <th style={{ padding: "3px 5px", background: "var(--navy-lite)" }}>Status</th>
              </tr></thead>
              <tbody>
                {plan.categoryRequirement.map(r => (
                  <tr key={r.category}>
                    <td style={{ padding: "3px 5px" }}><span className={`cat-tag cat-${r.category}`}>{r.category}</span></td>
                    {["M", "A", "N"].map(sh => (
                      <td key={sh} style={{ textAlign: "center", padding: "3px 5px", fontWeight: 700, color: r.needs[sh] > r.available ? "var(--red)" : "var(--green)" }}>{r.needs[sh]}</td>
                    ))}
                    <td style={{ textAlign: "center", padding: "3px 5px", fontWeight: 700, color: "var(--cyan)" }}>{r.available}</td>
                    <td style={{ textAlign: "center", padding: "3px 5px" }}>
                      <span className="tag" style={{ background: r.status === "OK" ? "rgba(0,200,83,.15)" : "rgba(229,57,53,.15)", color: r.status === "OK" ? "var(--green)" : "var(--red)" }}>{r.status === "OK" ? "✅ OK" : "⚠ SHORT"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-title">📋 Workload Summary</div>
          {!plan ? <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Run generation to see results</div> : plan.workloadSummary.length === 0 ? (
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>No workload configured yet — see the Workload Input tab.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {plan.workloadSummary.map((r, i) => (
                <div key={i}>
                  <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{r.label}</div>
                  <div style={{ fontSize: 13 }}>{r.count}<span style={{ fontSize: 9, color: "var(--text-dim)" }}> B1:{r.b1} B2:{r.b2} CM:{r.cm} NCS:{r.ncs}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
