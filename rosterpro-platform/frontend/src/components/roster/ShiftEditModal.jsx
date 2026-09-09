import { useState } from "react";

// Matches the prototype's .modal-overlay/.modal pattern (openModal/closeModal
// toggled a "open" class) — implemented here as simple conditional rendering
// instead, since React doesn't need the DOM-always-present-but-hidden
// pattern the vanilla-JS prototype used.
export default function ShiftEditModal({ cell, shiftDefs, onSave, onClose }) {
  const [shiftCode, setShiftCode] = useState(cell.currentCode || "O");
  // Pre-fill from this day's own override when one exists, else fall back to
  // the shift definition's default time — the field should always start
  // showing the EFFECTIVE time for today, editable from there, not blank.
  const initialDef = shiftDefs.find(d => d.code === (cell.currentCode || "O"));
  const [in1, setIn1] = useState(cell.currentIn1 || initialDef?.startTime || "");
  const [out1, setOut1] = useState(cell.currentOut1 || initialDef?.endTime || "");
  const [in2, setIn2] = useState(cell.currentIn2 || "");
  const [out2, setOut2] = useState(cell.currentOut2 || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const def = shiftDefs.find(d => d.code === shiftCode);
  // A working shift type (duty/night) needs a time, even one like Break
  // Shift or Flexi Shift whose OWN definition deliberately carries no
  // startTime/endTime — those are exactly the codes where the real time is
  // meant to be set per day, not off/leave/other codes which have none at all.
  const isTimed = def?.type === "duty" || def?.type === "night";
  const isBreakShift = shiftCode === "BS"; // split-duty day: a second in/out segment

  function handleShiftCodeChange(newCode) {
    setShiftCode(newCode);
    // Re-fill IN-1/OUT-1 from the newly selected shift's own default times —
    // still editable afterward, just a sensible starting point per shift.
    const newDef = shiftDefs.find(d => d.code === newCode);
    setIn1(newDef?.startTime || "");
    setOut1(newDef?.endTime || "");
    if (newCode !== "BS") { setIn2(""); setOut2(""); }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onSave({
        shiftCode, reason: reason || undefined,
        in1: isTimed ? (in1 || undefined) : undefined,
        out1: isTimed ? (out1 || undefined) : undefined,
        in2: isTimed && isBreakShift ? (in2 || undefined) : undefined,
        out2: isTimed && isBreakShift ? (out2 || undefined) : undefined,
      });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
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
          <label className="fl">Shift Code</label>
          <select className="fi" value={shiftCode} onChange={(e) => handleShiftCodeChange(e.target.value)}>
            {shiftDefs.map(d => (
              <option key={d.code} value={d.code}>{d.code} — {d.name}</option>
            ))}
          </select>
        </div>

        {isTimed && (
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">IN-1</label>
              <input className="fi" type="time" value={in1} onChange={(e) => setIn1(e.target.value)} />
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">OUT-1</label>
              <input className="fi" type="time" value={out1} onChange={(e) => setOut1(e.target.value)} />
            </div>
          </div>
        )}

        {isTimed && isBreakShift && (
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">IN-2 (BS only)</label>
              <input className="fi" type="time" value={in2} onChange={(e) => setIn2(e.target.value)} />
            </div>
            <div className="fg" style={{ flex: 1 }}>
              <label className="fl">OUT-2 (BS only)</label>
              <input className="fi" type="time" value={out2} onChange={(e) => setOut2(e.target.value)} />
            </div>
          </div>
        )}

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Reason (recorded in audit trail)</label>
          <input
            className="fi" type="text" placeholder="e.g. Swap with staff on request"
            value={reason} onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

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
