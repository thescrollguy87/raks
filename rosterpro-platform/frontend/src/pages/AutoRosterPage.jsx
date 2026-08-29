import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as rosterApi from "../api/roster.js";
import * as planningApi from "../api/rosterPlanning.js";
import * as staffApi from "../api/staff.js";
import * as leaveApi from "../api/leave.js";

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
    { key: "workload", label: "✈ Workload Input" },
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
      {tab === "workload" && <WorkloadInputTab stationId={stationId} />}
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
                <div className="card-title">{preview.violations.length ? `⚠️ ${preview.violations.length} Coverage Gaps in Generated Roster` : "✅ Generated Roster: Full Coverage"}</div>
                <div style={{ fontSize: 11 }}>{preview.staffCount} staff · {preview.blockedCount} blocked · {preview.assignmentCount} shifts to assign</div>
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
            <div style={{ fontSize: 11 }}>{applied.staffCount} staff, {applied.assignmentCount} shifts assigned, {applied.violations.length} coverage gaps remaining. Open <strong>Shift Roster</strong> to review or hand-edit individual cells, then Publish when ready.</div>
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
