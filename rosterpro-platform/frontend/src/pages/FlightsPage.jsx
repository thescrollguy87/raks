import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import * as flightsApi from "../api/flights.js";

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

  if (error) return <div className="ab red">{error}</div>;
  if (!flights) return <div className="card">Loading flights…</div>;

  return (
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
  );
}
