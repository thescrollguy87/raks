import { useState, useEffect, useCallback, useMemo } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as attendanceApi from "../api/attendance.js";
import * as regularizationApi from "../api/regularization.js";
import * as officeLocationApi from "../api/officeLocations.js";
import * as reportsApi from "../api/reports.js";

const STATUS_STYLE = {
  ON_TIME: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  LATE: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  EARLY_OUT: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  MISSING: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
  REGULARIZED: { background: "rgba(148,163,184,.15)", color: "var(--text-dim)" },
};
const REASON_LABELS = {
  FORGOT_TO_PUNCH: "Forgot to Punch", FLIGHT_DUTY: "Flight Duty", DEPUTATION: "Deputation",
  NETWORK_ISSUE: "Network Issue", OTHER: "Other",
};

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}
function currentMonthKey() { return new Date().toISOString().slice(0, 7); }
function monthRange(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const from = `${monthKey}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

// Geolocation Attendance — punch history, regularization (routed through
// the same L1 Manager approval as Leave), office-location geofence admin,
// and the monthly register export. Tabs mirror the Leave & Absence page's
// structure deliberately, for a consistent mental model across both.
export default function AttendancePage() {
  const { user, hasPermission } = useAuth();
  const { currentStation } = useStation();
  const [tab, setTab] = useState("mine");

  const canApproveAny = hasPermission("regularization", "approve") || hasPermission("regularization", "approve_reports");
  const canManageLocations = hasPermission("attendance", "manage");
  const canExportReports = hasPermission("reports", "export");

  usePageHeader({ title: "Attendance", subtitle: currentStation ? `${currentStation.name} Line Maintenance` : "" });

  return (
    <div>
      <div className="sh">
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {[
            ["mine", "My Attendance"],
            canApproveAny ? ["approvals", "Approvals"] : null,
            canManageLocations ? ["locations", "Office Locations"] : null,
            canExportReports ? ["register", "Register"] : null,
          ].filter(Boolean).map(([key, label]) => (
            <button key={key} className="btn btn-ghost" style={tab === key ? { borderColor: "var(--cyan)", color: "var(--cyan)" } : undefined} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "mine" && <MyAttendanceTab userId={user?.id} />}
      {tab === "approvals" && canApproveAny && <ApprovalsTab />}
      {tab === "locations" && canManageLocations && <OfficeLocationsTab stationId={currentStation?.id} />}
      {tab === "register" && canExportReports && <RegisterTab stationId={currentStation?.id} />}
    </div>
  );
}

function MyAttendanceTab({ userId }) {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [days, setDays] = useState(null);
  const [regs, setRegs] = useState(null);
  const [error, setError] = useState("");
  const [regFormFor, setRegFormFor] = useState(null); // date string or null

  const load = useCallback(() => {
    if (!userId) return;
    const { from, to } = monthRange(monthKey);
    attendanceApi.getOverview({ userId, from, to }).then(d => setDays(d.days)).catch(err => setError(err.message));
    regularizationApi.listRegularizations({ userId, pageSize: 100 }).then(d => setRegs(d.items)).catch(() => {});
  }, [userId, monthKey]);
  useEffect(() => { load(); }, [load]);

  const regByDate = useMemo(() => {
    const m = new Map();
    for (const r of regs || []) m.set(r.attendanceRecord.date.slice(0, 10), r);
    return m;
  }, [regs]);

  return (
    <div>
      <div className="card">
        <div className="sh" style={{ marginBottom: 4 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Month</div>
          <input className="fi" type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} style={{ width: 160 }} />
        </div>
      </div>

      {error && <div className="ab red">{error}</div>}

      <div className="card">
        <div className="card-title">Your Attendance</div>
        {!days ? <div>Loading…</div> : (
          <table className="rt" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Date</th><th>Scheduled</th><th>Punch In</th><th>Punch Out</th><th>Status</th><th>Regularization</th>
              </tr>
            </thead>
            <tbody>
              {days.map(d => {
                const reg = regByDate.get(d.date);
                const status = d.record?.status;
                return (
                  <tr key={d.date}>
                    <td style={{ textAlign: "left" }}>{d.date}</td>
                    <td>{d.exempt ? "—" : d.scheduledShift?.code || "O"}</td>
                    <td>{fmtTime(d.record?.punchInAt)}</td>
                    <td>{fmtTime(d.record?.punchOutAt)}</td>
                    <td>{status ? <span className="tag" style={STATUS_STYLE[status]}>{status.replace("_", " ")}</span> : d.exempt ? "—" : ""}</td>
                    <td>
                      {reg ? (
                        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{reg.status} ({REASON_LABELS[reg.reason]})</span>
                      ) : d.needsRegularization ? (
                        regFormFor === d.date ? (
                          <RegularizationInlineForm date={d.date} onDone={() => { setRegFormFor(null); load(); }} onCancel={() => setRegFormFor(null)} />
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => setRegFormFor(d.date)}>Request Regularization</button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RegularizationInlineForm({ date, onDone, onCancel }) {
  const [reason, setReason] = useState("FORGOT_TO_PUNCH");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true); setError("");
    try {
      await regularizationApi.createRegularization({ date, reason, detail: detail || undefined });
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
      <select className="fi" value={reason} onChange={e => setReason(e.target.value)}>
        {Object.entries(REASON_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input className="fi" placeholder="Detail (optional)" value={detail} onChange={e => setDetail(e.target.value)} />
      {error && <div style={{ fontSize: 10, color: "var(--rp-red)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 4 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>Submit</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ApprovalsTab() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    regularizationApi.listRegularizations({ pageSize: 100 }).then(d => setItems(d.items)).catch(err => setError(err.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id, decision) {
    let reason;
    if (decision === "REJECTED") {
      reason = prompt("Comment (required when rejecting):");
      if (!reason || !reason.trim()) { alert("A comment is required to reject a regularization request."); return; }
    }
    try {
      await regularizationApi.decideRegularization(id, decision, reason);
      load();
    } catch (err) { alert(`Failed: ${err.message}`); }
  }

  const pending = (items || []).filter(i => i.status === "PENDING");
  const decided = (items || []).filter(i => i.status !== "PENDING");

  return (
    <div>
      {error && <div className="ab red">{error}</div>}
      <div className="card">
        <div className="card-title">Pending Regularizations</div>
        {!items ? <div>Loading…</div> : pending.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No requests to show.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pending.map(r => (
              <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{r.user?.fullName} <span style={{ fontWeight: 500, color: "var(--text-dim)" }}>· {r.user?.category}</span></div>
                  <span className="tag" style={STATUS_STYLE[r.attendanceRecord.status] || {}}>{REASON_LABELS[r.reason]}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
                  {r.attendanceRecord.date.slice(0, 10)} · {r.attendanceRecord.scheduledShiftCode || "—"}
                  {r.detail ? ` — "${r.detail}"` : ""}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => decide(r.id, "APPROVED")}>Approve</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => decide(r.id, "REJECTED")}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Decided</div>
        {decided.length === 0 ? <div style={{ fontSize: 11, color: "var(--text-dim)" }}>None yet.</div> : (
          <table className="rt" style={{ width: "100%" }}>
            <thead><tr><th style={{ textAlign: "left" }}>Staff</th><th>Date</th><th>Reason</th><th>Status</th></tr></thead>
            <tbody>
              {decided.map(r => (
                <tr key={r.id}>
                  <td style={{ textAlign: "left" }}>{r.user?.fullName}</td>
                  <td>{r.attendanceRecord.date.slice(0, 10)}</td>
                  <td>{REASON_LABELS[r.reason]}</td>
                  <td><span className="tag" style={r.status === "APPROVED" ? STATUS_STYLE.ON_TIME : STATUS_STYLE.MISSING}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function OfficeLocationsTab({ stationId }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState(200);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    officeLocationApi.listOfficeLocations({}).then(d => setItems(d.items)).catch(err => setError(err.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!name.trim() || !lat || !lng) { setError("Name, latitude and longitude are required"); return; }
    setBusy(true); setError("");
    try {
      await officeLocationApi.createOfficeLocation({ stationId, name: name.trim(), latitude: Number(lat), longitude: Number(lng), radiusMeters: Number(radius) });
      setName(""); setLat(""); setLng("");
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Remove this office location?")) return;
    try { await officeLocationApi.deleteOfficeLocation(id); load(); } catch (err) { alert(`Failed: ${err.message}`); }
  }

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(pos => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); });
  }

  return (
    <div>
      {error && <div className="ab red">{error}</div>}
      <div className="card">
        <div className="card-title">Add Office Location</div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
          A punch succeeds if it's within radius of ANY configured location. Use a wider radius for hangars — GPS accuracy degrades significantly near large metal structures and indoors.
        </div>
        <div className="fg2" style={{ marginBottom: 8 }}>
          <div className="fg"><label className="fl">Name</label><input className="fi" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hangar 1" /></div>
          <div className="fg"><label className="fl">Radius (meters)</label><input className="fi" type="number" value={radius} onChange={e => setRadius(e.target.value)} /></div>
        </div>
        <div className="fg2" style={{ marginBottom: 8 }}>
          <div className="fg"><label className="fl">Latitude</label><input className="fi" value={lat} onChange={e => setLat(e.target.value)} /></div>
          <div className="fg"><label className="fl">Longitude</label><input className="fi" value={lng} onChange={e => setLng(e.target.value)} /></div>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }} onClick={useMyLocation}>📍 Use my current location</button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={add}>＋ Add Location</button>
      </div>

      <div className="card">
        <div className="card-title">Configured Locations</div>
        {!items ? <div>Loading…</div> : items.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No office locations configured — staff cannot punch in until at least one exists.</div>
        ) : (
          <table className="rt" style={{ width: "100%" }}>
            <thead><tr><th style={{ textAlign: "left" }}>Name</th><th>Lat</th><th>Lng</th><th>Radius</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map(l => (
                <tr key={l.id}>
                  <td style={{ textAlign: "left" }}>{l.name}</td>
                  <td>{l.latitude.toFixed(5)}</td>
                  <td>{l.longitude.toFixed(5)}</td>
                  <td>{l.radiusMeters}m</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => remove(l.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RegisterTab({ stationId }) {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function download(format) {
    setBusy(true); setMessage("");
    try {
      await reportsApi.downloadReport("attendance-register", format, { stationId, monthKey });
    } catch (err) { setMessage(err.message); } finally { setBusy(false); }
  }

  async function sendEmail() {
    if (!email) { setMessage("Enter an email address"); return; }
    setBusy(true); setMessage("");
    try {
      await reportsApi.emailReport("attendance-register", "excel", { stationId, monthKey }, email);
      setMessage(`Sent to ${email}`);
    } catch (err) { setMessage(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="card-title">Monthly Attendance Register</div>
      <div className="fg" style={{ marginBottom: 12, maxWidth: 200 }}>
        <label className="fl">Month</label>
        <input className="fi" type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} />
      </div>
      {message && <div className="ab" style={{ marginBottom: 10 }}>{message}</div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => download("excel")}>⬇ Excel</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => download("pdf")}>⬇ PDF</button>
      </div>
      <div className="fg2" style={{ alignItems: "flex-end", maxWidth: 400 }}>
        <div className="fg"><label className="fl">Email to</label><input className="fi" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@akasaair.com" /></div>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={sendEmail}>Send</button>
      </div>
    </div>
  );
}
