import { useState } from "react";
import * as leaveApi from "../../api/leave.js";

const LEAVE_TYPES = ["ANNUAL", "SICK", "CASUAL", "MEDICAL", "LWP", "TRAINING", "OTHER"];

export default function RequestLeaveModal({ onSaved, onClose }) {
  const [leaveType, setLeaveType] = useState("ANNUAL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await leaveApi.requestLeave({ leaveType, fromDate, toDate, reason: reason || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to submit leave request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">Request Leave</div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Leave Type</label>
          <select className="fi" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
            {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="fg2" style={{ marginBottom: 12 }}>
          <div className="fg">
            <label className="fl">From</label>
            <input className="fi" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
          </div>
          <div className="fg">
            <label className="fl">To</label>
            <input className="fi" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} required />
          </div>
        </div>
        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Reason (optional)</label>
          <input className="fi" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Submitting…" : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
