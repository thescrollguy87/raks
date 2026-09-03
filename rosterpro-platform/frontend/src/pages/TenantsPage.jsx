import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import * as airlinesApi from "../api/airlines.js";
import CreateAirlineModal from "../components/admin/CreateAirlineModal.jsx";

// SUPER_ADMIN-only — the one screen in the app that's meant to see across
// every tenant (see ProtectedRoute's role gate on this route, and the
// backend's requireRole("SUPER_ADMIN") on GET/POST /api/airlines). Answers
// "is another airline tenant provisioned yet" without a database query,
// and is the only place a new one can be added.
export default function TenantsPage() {
  const [airlines, setAirlines] = useState(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  usePageHeader({ title: "Tenants", subtitle: "Every airline provisioned on this platform" });

  const load = useCallback(() => {
    airlinesApi.listAirlines().then(setAirlines).catch(err => setError(err.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="ab red">{error}</div>;
  if (!airlines) return <div className="card">Loading tenants…</div>;

  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Airlines <span className="tag">{airlines.length} total</span></span>
        <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>＋ Add Airline</button>
      </div>
      <table className="rt" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", paddingLeft: 9 }}>Name</th>
            <th style={{ textAlign: "left" }}>ICAO / IATA</th>
            <th>Status</th>
            <th>Stations</th>
            <th>Active Staff</th>
            <th style={{ textAlign: "left" }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {airlines.map(a => (
            <tr key={a.id}>
              <td style={{ textAlign: "left", paddingLeft: 9, fontWeight: 600 }}>{a.name}</td>
              <td style={{ textAlign: "left" }}>{a.icaoCode}{a.iataCode ? ` / ${a.iataCode}` : ""}</td>
              <td style={{ textAlign: "center" }}>
                <span className={a.isActive ? "hrs-ok" : "hrs-over"}>{a.isActive ? "Active" : "Inactive"}</span>
              </td>
              <td style={{ textAlign: "center" }}>{a.stationCount}</td>
              <td style={{ textAlign: "center" }}>{a.activeStaffCount}</td>
              <td style={{ textAlign: "left" }}>{new Date(a.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {airlines.length === 0 && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>No airlines provisioned yet.</div>}
      {showCreate && <CreateAirlineModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}
