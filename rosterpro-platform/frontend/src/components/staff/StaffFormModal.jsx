import { useState, useEffect } from "react";
import * as staffApi from "../../api/staff.js";
import { useStation } from "../../store/StationContext.jsx";

const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];

// One Role per real-world designation — each one is a distinct backend
// permission grant (see prisma/seed.js ROLE_MATRIX), not just a label.
// Only the first four carry edit/approve rights anywhere in the app;
// everything else is view-only + can request their own leave.
const ROLES = [
  "SUPER_ADMIN", "AIRLINE_ADMIN", "STATION_MANAGER", "LMM", "SHIFT_INCHARGE",
  "DUTY_ENGINEER", "SR_AME", "AME", "CM", "SR_TECH", "TECH", "JR_TECH", "NCS", "STORES",
  "READ_ONLY_AUDITOR",
];
const ROLE_LABELS = {
  SUPER_ADMIN: "Super Admin", AIRLINE_ADMIN: "Airline Admin", STATION_MANAGER: "Station Manager",
  LMM: "LMM", SHIFT_INCHARGE: "Shift Incharge", DUTY_ENGINEER: "Duty Engineer", SR_AME: "Sr. AME",
  AME: "AME", CM: "Certifying Mechanic (CM)", SR_TECH: "Sr. Tech", TECH: "Tech", JR_TECH: "Jr. Tech",
  NCS: "NCS", STORES: "Stores", READ_ONLY_AUDITOR: "Read-Only Auditor",
};

// Same modal for add and edit — editingStaff is null for "add". Email is
// create-only (no endpoint to change a staff member's login email here).
// Role and L1 Manager ARE editable now — Role via the dedicated
// assignRoles endpoint, L1 Manager via the regular update.
export default function StaffFormModal({ editingStaff, onSaved, onClose }) {
  const { stationId } = useStation();
  const isEdit = !!editingStaff;
  const [email, setEmail] = useState(editingStaff?.email || "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(editingStaff?.fullName || "");
  const [employeeId, setEmployeeId] = useState(editingStaff?.employeeId || "");
  const [designation, setDesignation] = useState(editingStaff?.designation || "");
  const [category, setCategory] = useState(editingStaff?.category || "NCS");
  const [role, setRole] = useState(editingStaff?.roles?.[0] || "TECH");
  const [reportsToId, setReportsToId] = useState(editingStaff?.reportsToId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [staffOptions, setStaffOptions] = useState([]);

  // L1 Manager picker: everyone else at this station (excluding self, so
  // nobody can be set as their own manager).
  useEffect(() => {
    if (!stationId) return;
    staffApi.listStaff({ page: 1, pageSize: 200, stationId })
      .then(d => setStaffOptions((d.items || []).filter(s => s.id !== editingStaff?.id)))
      .catch(() => {});
  }, [stationId, editingStaff?.id]);

  async function handleSave() {
    if (!fullName.trim()) { setError("Enter the staff member's name"); return; }
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await staffApi.updateStaff(editingStaff.id, {
          fullName, employeeId: employeeId || null, designation: designation || null, category,
          reportsToId: reportsToId || null,
        });
        if (role && !editingStaff.roles?.includes(role)) {
          await staffApi.assignRoles(editingStaff.id, [role]);
        }
      } else {
        if (!email.trim()) { setError("Enter an email — it's also their login"); setSaving(false); return; }
        if (!password) { setError("Set a temporary password (10+ chars, letters and numbers)"); setSaving(false); return; }
        if (!role) { setError("Select a role"); setSaving(false); return; }
        await staffApi.createStaff({
          email, password, fullName, employeeId: employeeId || undefined,
          designation: designation || undefined, category, roles: [role],
          reportsToId: reportsToId || undefined,
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
        <div className="fg2" style={{ marginBottom: 12 }}>
          <div className="fg">
            <label className="fl">Designation</label>
            <input className="fi" type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Sr. AME" />
          </div>
          <div className="fg">
            <label className="fl">Role</label>
            <select className="fi" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
        </div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">L1 Manager <span style={{ fontWeight: 400, color: "var(--text-dim)" }}>(who this person reports to)</span></label>
          <select className="fi" value={reportsToId} onChange={(e) => setReportsToId(e.target.value)}>
            <option value="">— None —</option>
            {staffOptions.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>

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
