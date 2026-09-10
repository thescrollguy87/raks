import { useState, useEffect, useCallback, useRef } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import * as flightsApi from "../api/flights.js";

function todayMonthKey() { return new Date().toISOString().slice(0, 7); }

const STATUS_STYLE = {
  SCHEDULED: { background: "rgba(148,163,184,.15)", color: "var(--text-dim)" },
  ARRIVED: { background: "rgba(0,198,255,.1)", color: "var(--cyan)" },
  DEPARTED: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  DELAYED: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  CANCELLED: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
};

function todayRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return { from, to };
}

export default function FlightsPage() {
  const { stationId, currentStation } = useStation();
  const { hasPermission } = useAuth();
  const [flights, setFlights] = useState(null);
  const [error, setError] = useState("");
  const canLogDelay = hasPermission("engineering_delay", "create");
  const canImport = hasPermission("flight", "read");

  const [importMonthKey, setImportMonthKey] = useState(todayMonthKey());
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const importInputRef = useRef(null);

  usePageHeader({ title: "Flights", subtitle: currentStation ? `${currentStation.iataCode} · Today's flights & engineering delays` : "" });

  const load = useCallback(() => {
    if (!stationId) return;
    const { from, to } = todayRange();
    flightsApi.listFlights(stationId, from, to).then(setFlights).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(() => { load(); }, [load]);

  async function handleLogDelay(flight) {
    const delayCode = prompt("Delay code (e.g. 76 for tech delay):");
    if (!delayCode) return;
    const minutes = parseInt(prompt("Delay minutes:"), 10);
    if (!minutes || minutes <= 0) return;
    const description = prompt("Description:");
    if (!description) return;
    try {
      await flightsApi.recordDelay({ flightId: flight.id, delayCode, minutes, description });
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  function handleImportFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleImport(file);
  }

  async function handleImport(file) {
    if (!stationId) return;
    setImportBusy(true); setImportResult(null);
    try {
      const r = await flightsApi.importFlightSchedule(stationId, importMonthKey, file);
      setImportResult({ tone: "green", text: `${r.created} created, ${r.updated} updated (${r.occurrenceCount} flight occurrences this month).` });
      load();
    } catch (err) {
      setImportResult({ tone: "red", text: err.message });
    } finally {
      setImportBusy(false);
    }
  }

  if (error) return <div className="ab red">{error}</div>;
  if (!flights) return <div className="card">Loading flights…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {canImport && (
        <div className="card">
          <div className="card-title">⬆ Import Flight Schedule</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
            A recurring monthly pattern ("Mon,Wed,Fri" or "Daily") expanded into individual flights for {currentStation?.name}. Re-importing the same file for the same month updates those flights instead of duplicating them — the numbers below and on the Dashboard/Shift Roster's Flight Coverage come straight from this.
          </div>
          <div className="fg" style={{ marginBottom: 10, maxWidth: 200 }}>
            <label className="fl">Month</label>
            <input className="fi" type="month" value={importMonthKey} onChange={(e) => setImportMonthKey(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => flightsApi.downloadFlightScheduleTemplate()}>⬇ Download Template</button>
            <input ref={importInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleImportFileChosen} />
            <button className="btn btn-primary" disabled={importBusy} onClick={() => importInputRef.current?.click()}>
              {importBusy ? "Importing…" : "⬆ Import"}
            </button>
          </div>
          {importResult && (
            <div style={{
              marginTop: 10, padding: "8px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: importResult.tone === "red" ? "rgba(229,57,53,.12)" : "rgba(0,200,83,.1)",
              color: importResult.tone === "red" ? "var(--rp-red)" : "var(--rp-green)",
            }}>
              {importResult.text}
            </div>
          )}
        </div>
      )}

      <div className="card">
      <div className="card-title">Today's Flights <span className="tag">{flights.length}</span></div>
      <table className="rt" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Flight</th>
            <th style={{ textAlign: "left" }}>Aircraft</th>
            <th>Scheduled In</th>
            <th>Scheduled Out</th>
            <th>Status</th>
            <th>Delays</th>
            {canLogDelay && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {flights.map(f => (
            <tr key={f.id}>
              <td style={{ textAlign: "left", padding: "6px 4px" }}>{f.flightNumber}</td>
              <td style={{ textAlign: "left", fontSize: 10, color: "var(--text-dim)" }}>{f.aircraft?.registration || "—"}</td>
              <td>{f.scheduledIn ? new Date(f.scheduledIn).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
              <td>{f.scheduledOut ? new Date(f.scheduledOut).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
              <td><span className="tag" style={STATUS_STYLE[f.status]}>{f.status}</span></td>
              <td style={{ fontSize: 10 }}>
                {f.engineeringDelays?.length > 0
                  ? `${f.engineeringDelays.length} (${f.engineeringDelays.reduce((s, d) => s + d.minutes, 0)}min)`
                  : "—"}
              </td>
              {canLogDelay && (
                <td><button className="btn btn-ghost btn-sm" onClick={() => handleLogDelay(f)}>+ Delay</button></td>
              )}
            </tr>
          ))}
          {flights.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 12, fontSize: 11, color: "var(--text-dim)" }}>No flights scheduled today.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
