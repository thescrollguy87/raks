import { useState } from "react";
import * as stationsApi from "../../api/stations.js";

const EMPTY = { name: "", iataCode: "", icaoCode: "" };

// Adds a station to whichever airline is currently selected in the
// switcher (see AirlineSwitcher.jsx) — there's deliberately no airline
// picker here: switch airlines first, then add a station to it, same
// "you operate on whatever's currently selected" model the rest of the
// app already uses for stationId. Reachable by SUPER_ADMIN (any airline)
// and AIRLINE_ADMIN (their own airline only — enforced server-side in
// stationService.createStation, not just by hiding the button).
export default function AddStationModal({ airlineName, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleCreate() {
    setSaving(true);
    setError("");
    try {
      const station = await stationsApi.createStation({
        name: form.name, iataCode: form.iataCode, icaoCode: form.icaoCode || undefined,
      });
      onCreated(station);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to add station");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">🏭 Add Station</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 14 }}>
          Adds a new station to {airlineName ? <strong>{airlineName}</strong> : "the current airline"}. To add a station to a different airline, switch to it first.
        </div>

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div className="fg" style={{ marginBottom: 8 }}>
          <label className="fl">Name</label>
          <input className="fi" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Mumbai Line Maintenance" />
        </div>
        <div className="fg2" style={{ marginBottom: 12 }}>
          <div className="fg"><label className="fl">IATA code</label><input className="fi" value={form.iataCode} onChange={e => set("iataCode", e.target.value.toUpperCase())} placeholder="e.g. BOM" maxLength={10} /></div>
          <div className="fg"><label className="fl">ICAO code (optional)</label><input className="fi" value={form.icaoCode} onChange={e => set("icaoCode", e.target.value.toUpperCase())} placeholder="e.g. VABB" maxLength={10} /></div>
        </div>

        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleCreate}>
            {saving ? "Adding…" : "Add Station"}
          </button>
        </div>
      </div>
    </div>
  );
}
