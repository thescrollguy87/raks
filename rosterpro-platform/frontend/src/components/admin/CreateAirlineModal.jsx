import { useState } from "react";
import * as airlinesApi from "../../api/airlines.js";

const EMPTY = {
  airlineName: "", icaoCode: "", iataCode: "",
  stationName: "", stationIataCode: "", stationIcaoCode: "",
  adminFullName: "", adminEmail: "", adminPassword: "",
};

// Provisions a brand-new tenant: the Airline, its first Station, and a
// first AIRLINE_ADMIN login, all in one backend transaction (see
// POST /api/airlines) — this is the only "create tenant" path in the app,
// deliberately reachable only from TenantsPage (SUPER_ADMIN-only).
export default function CreateAirlineModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleCreate() {
    setSaving(true);
    setError("");
    try {
      await airlinesApi.createAirline({
        airline: { name: form.airlineName, icaoCode: form.icaoCode, iataCode: form.iataCode || undefined },
        station: { name: form.stationName, iataCode: form.stationIataCode, icaoCode: form.stationIcaoCode || undefined },
        admin: { fullName: form.adminFullName, email: form.adminEmail, password: form.adminPassword },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create tenant");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">🏢 Add Airline Tenant</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 14 }}>
          Creates the airline, its first station, and a first Airline Admin login — the new tenant starts completely empty otherwise (no shared shift codes, rules, or data from any other airline).
        </div>

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div className="fl" style={{ fontWeight: 700, marginBottom: 4 }}>Airline</div>
        <div className="fg" style={{ marginBottom: 8 }}>
          <label className="fl">Name</label>
          <input className="fi" value={form.airlineName} onChange={e => set("airlineName", e.target.value)} placeholder="e.g. Example Airways" />
        </div>
        <div className="fg2" style={{ marginBottom: 12 }}>
          <div className="fg"><label className="fl">ICAO code</label><input className="fi" value={form.icaoCode} onChange={e => set("icaoCode", e.target.value.toUpperCase())} placeholder="e.g. EXW" maxLength={10} /></div>
          <div className="fg"><label className="fl">IATA code (optional)</label><input className="fi" value={form.iataCode} onChange={e => set("iataCode", e.target.value.toUpperCase())} placeholder="e.g. EX" maxLength={5} /></div>
        </div>

        <div className="fl" style={{ fontWeight: 700, marginBottom: 4 }}>First Station</div>
        <div className="fg" style={{ marginBottom: 8 }}>
          <label className="fl">Name</label>
          <input className="fi" value={form.stationName} onChange={e => set("stationName", e.target.value)} placeholder="e.g. Mumbai Line Maintenance" />
        </div>
        <div className="fg2" style={{ marginBottom: 12 }}>
          <div className="fg"><label className="fl">IATA code</label><input className="fi" value={form.stationIataCode} onChange={e => set("stationIataCode", e.target.value.toUpperCase())} placeholder="e.g. BOM" maxLength={10} /></div>
          <div className="fg"><label className="fl">ICAO code (optional)</label><input className="fi" value={form.stationIcaoCode} onChange={e => set("stationIcaoCode", e.target.value.toUpperCase())} placeholder="e.g. VABB" maxLength={10} /></div>
        </div>

        <div className="fl" style={{ fontWeight: 700, marginBottom: 4 }}>First Admin Login</div>
        <div className="fg" style={{ marginBottom: 8 }}>
          <label className="fl">Full name</label>
          <input className="fi" value={form.adminFullName} onChange={e => set("adminFullName", e.target.value)} />
        </div>
        <div className="fg" style={{ marginBottom: 8 }}>
          <label className="fl">Email</label>
          <input className="fi" type="email" value={form.adminEmail} onChange={e => set("adminEmail", e.target.value)} />
        </div>
        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Password (min 10 characters, at least one letter and one number)</label>
          <input className="fi" type="text" value={form.adminPassword} onChange={e => set("adminPassword", e.target.value)} placeholder="Set the admin's initial password" />
        </div>

        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleCreate}>
            {saving ? "Creating…" : "Create Tenant"}
          </button>
        </div>
      </div>
    </div>
  );
}
