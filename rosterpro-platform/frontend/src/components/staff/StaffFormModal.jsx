import { useState } from "react";
import * as staffApi from "../../api/staff.js";
import { useStation } from "../../store/StationContext.jsx";

const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const ROLES = [
  "SUPER_ADMIN", "AIRLINE_ADMIN", "STATION_MANAGER", "LMM",
  "SHIFT_ENGINEER", "AME", "TECHNICIAN", "STORE_KEEPER", "READ_ONLY_AUDITOR",
];

// Same modal for add and edit — editingStaff is null for "add". Password/
// email/roles are create-only: the backend has no endpoint to change a
// staff member's login email or role set here (roles have their own
// dedicated endpoint, not exposed in the UI yet since this pass is about
// reaching parity with the prototype's add/edit/remove/delete, not a full
// role-management screen).
export default function StaffFormModal({ editingStaff, onSaved, onClose }) {
  const { stationId } = useStation();
  const isEdit = !!editingStaff;
  const [email, setEmail] = useState(editingStaff?.email || "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(editingStaff?.fullName || "");
  const [employeeId, setEmployeeId] = useState(editingStaff?.employeeId || "");
  const [designation, setDesignation] = useState(editingStaff?.designation || "");
  const [category, setCategory] = useState(editingStaff?.category || "NCS");
  const [roles, setRoles] = useState(editingStaff?.roles || ["TECHNICIAN"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleRole(role) {
    setRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  }

  async function handleSave() {
    if (!fullName.trim()) { setError("Enter the staff member's name"); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await staffApi.updateStaff(editingStaff.id, {
          fullName, employeeId: employeeId || null, designation: designation || null, category,
        });
      } else {
        if (!email.trim()) { setError("Enter an email — it's also their login"); setSaving(false); return; }
        if (!password) { setError("Set a temporary password (10+ chars, letters and numbers)"); setSaving(false); return; }
        if (!roles.length) { setError("Select at least one role"); setSaving(false); return; }
        await staffApi.createStaff({
          email, password, fullName, employeeId: employeeId || undefined,
          designation: designation || undefined, category, roles,
          // Only meaningful for an airline-wide caller (SUPER_ADMIN/
          // AIRLINE_ADMIN) — a station-scoped caller's own station always
          // wins server-side regardless of what's sent here. Without this,
          // an admin's new hire used to land with no station at all,
          // invisible from every station-scoped screen.
          stationId: stationId || undefined,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save staff member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">{isEdit ? "Edit Staff Member" : "Add Staff Member"}</div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Full Name</label>
          <input className="fi" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>

        {!isEdit && (
          <>
            <div className="fg" style={{ marginBottom: 12 }}>
              <label className="fl">Email (also their login)</label>
              <input className="fi" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="fg" style={{ marginBottom: 12 }}>
              <label className="fl">Temporary Password</label>
              <input className="fi" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="10+ chars, at least one letter and one number" />
            </div>
          </>
        )}

        <div className="fg2" style={{ marginBottom: 12 }}>
          <div className="fg">
            <label className="fl">Employee ID</label>
            <input className="fi" type="text" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
          </div>
          <div className="fg">
            <label className="fl">Category</label>
            <select className="fi" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Designation</label>
          <input className="fi" type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} />
        </div>

        {!isEdit && (
          <div className="fg" style={{ marginBottom: 12 }}>
            <label className="fl">Roles</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ROLES.map(r => (
                <button
                  key={r} type="button"
                  className="tag"
                  style={{
                    cursor: "pointer", border: "1px solid var(--border)",
                    background: roles.includes(r) ? "rgba(0,198,255,.15)" : "var(--glass)",
                    color: roles.includes(r) ? "var(--cyan)" : "var(--text-dim)",
                  }}
                  onClick={() => toggleRole(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Staff Member"}
          </button>
        </div>
      </div>
    </div>
  );
}
