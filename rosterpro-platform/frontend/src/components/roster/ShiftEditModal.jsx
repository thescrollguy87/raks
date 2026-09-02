import { useState } from "react";

// Matches the prototype's .modal-overlay/.modal pattern (openModal/closeModal
// toggled a "open" class) — implemented here as simple conditional rendering
// instead, since React doesn't need the DOM-always-present-but-hidden
// pattern the vanilla-JS prototype used.
export default function ShiftEditModal({ cell, shiftDefs, onSave, onDelete, onClose }) {
  const [shiftCode, setShiftCode] = useState(cell.currentCode || "O");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onSave({ shiftCode, reason: reason || undefined });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Clear ${cell.staffName}'s shift on ${cell.dateLabel}? This removes the assignment entirely (different from marking it "O" Off).`)) return;
    setDeleting(true);
    setError("");
    try {
      await onDelete({ reason: reason || undefined });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to clear shift");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">Edit Shift</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 14 }}>
          {cell.staffName} — {cell.dateLabel}
        </div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Shift</label>
          <select className="fi" value={shiftCode} onChange={(e) => setShiftCode(e.target.value)}>
            {shiftDefs.map(d => (
              <option key={d.code} value={d.code}>{d.code} — {d.name}</option>
            ))}
          </select>
        </div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Reason (recorded in audit trail)</label>
          <input
            className="fi" type="text" placeholder="e.g. Swap with staff on request"
            value={reason} onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 7, justifyContent: "space-between" }}>
          {cell.hasAssignment ? (
            <button className="btn btn-ghost" style={{ color: "var(--rp-red)" }} disabled={deleting || saving} onClick={handleDelete}>
              {deleting ? "Clearing…" : "🗑 Clear Shift"}
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || deleting} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
