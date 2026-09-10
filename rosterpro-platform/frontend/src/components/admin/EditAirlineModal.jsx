import { useState } from "react";
import * as airlinesApi from "../../api/airlines.js";

// Rebrands an existing tenant — its display name, ICAO/IATA codes, and the
// logo shown in the sidebar's top-left corner (Sidebar.jsx) in place of the
// generic RosterPro mark. Separate from CreateAirlineModal, which also
// provisions a first station + admin login that make no sense to touch here.
export default function EditAirlineModal({ airline, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: airline.name, icaoCode: airline.icaoCode, iataCode: airline.iataCode || "", logoUrl: airline.logoUrl || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field, value) { setForm(f => ({ ...f, [field]: value })); }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await airlinesApi.updateAirline(airline.id, {
        name: form.name, icaoCode: form.icaoCode, iataCode: form.iataCode || null, logoUrl: form.logoUrl || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to update airline");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">✏️ Edit Airline</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 14 }}>
          Changes here are the tenant's own branding — its name and logo appear in the sidebar's top-left corner for everyone at this airline, in place of the generic RosterPro mark.
        </div>

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div className="fg" style={{ marginBottom: 8 }}>
          <label className="fl">Name</label>
          <input className="fi" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Akasa Air" />
        </div>
        <div className="fg2" style={{ marginBottom: 8 }}>
          <div className="fg"><label className="fl">ICAO code</label><input className="fi" value={form.icaoCode} onChange={e => set("icaoCode", e.target.value.toUpperCase())} maxLength={10} /></div>
          <div className="fg"><label className="fl">IATA code (optional)</label><input className="fi" value={form.iataCode} onChange={e => set("iataCode", e.target.value.toUpperCase())} maxLength={5} /></div>
        </div>
        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Logo URL (optional)</label>
          <input className="fi" value={form.logoUrl} onChange={e => set("logoUrl", e.target.value)} placeholder="https://…/logo.png" />
          {form.logoUrl && (
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <img src={form.logoUrl} alt="" style={{ width: 28, height: 28, objectFit: "contain", borderRadius: 5, background: "#fff" }} onError={(e) => { e.target.style.visibility = "hidden"; }} />
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Preview</span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
