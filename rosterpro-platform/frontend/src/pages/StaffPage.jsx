import { useState, useEffect, useCallback, useMemo } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import * as staffApi from "../api/staff.js";
import StaffFormModal from "../components/staff/StaffFormModal.jsx";

export default function StaffPage() {
  const { hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);

  const canCreate = hasPermission("staff", "create");
  const canUpdate = hasPermission("staff", "update");
  const canDeactivate = hasPermission("staff", "deactivate");
  const canDelete = hasPermission("staff", "delete");

  const load = useCallback(() => {
    setError("");
    staffApi.listStaff({ page: 1, pageSize: 100 })
      .then(d => setData(d))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Memoized — see RosterPage.jsx for why: usePageHeader re-syncs whenever
  // `actions` changes reference, and this component re-renders on every
  // header-context update, so a fresh JSX element here every render would
  // loop the two forever.
  const headerActions = useMemo(() => (
    canCreate ? <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>＋ Add Staff</button> : null
  ), [canCreate]);

  usePageHeader({ title: "Staff Registry", subtitle: "AMD Line Maintenance", actions: headerActions });

  async function handleDeactivate(s) {
    if (!confirm(`Mark ${s.fullName} as inactive?\n\nThey'll be hidden from future roster generation, but their historical records are kept.`)) return;
    try {
      await staffApi.deactivateStaff(s.id);
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  async function handleReactivate(s) {
    try {
      await staffApi.reactivateStaff(s.id);
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  async function handleDelete(s) {
    if (!confirm(`PERMANENTLY delete ${s.fullName}?\n\nThis cannot be undone — their qualification, license, training, leave, and shift history will be removed. If you just want to stop scheduling them but keep their history, use "Deactivate" instead.`)) return;
    try {
      await staffApi.deleteStaff(s.id);
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  if (loading) return <div className="card">Loading staff…</div>;
  if (error) return <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>;

  return (
    <div className="card">
      <div className="card-title">
        Staff Registry <span className="tag">{data.total} total</span>
      </div>
      <table className="rt" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Name</th>
            <th>Category</th>
            <th style={{ textAlign: "left" }}>Designation</th>
            <th>Status</th>
            <th>Roles</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map(s => (
            <tr key={s.id} style={!s.isActive ? { opacity: 0.6 } : undefined}>
              <td style={{ textAlign: "left", padding: "6px 4px" }}>{s.fullName}</td>
              <td><span className={`cat-tag cat-${s.category || "NCS"}`}>{s.category || "NCS"}</span></td>
              <td style={{ textAlign: "left" }}>{s.designation}</td>
              <td>
                <span className="tag" style={{ background: s.isActive ? "rgba(0,200,83,.12)" : "rgba(148,163,184,.15)", color: s.isActive ? "var(--rp-green)" : "var(--text-dim)" }}>
                  {s.isActive ? "Active" : "Inactive"}
                </span>
              </td>
              <td style={{ fontSize: 10, color: "var(--text-dim)" }}>{s.roles.join(", ")}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {canUpdate && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingStaff(s)}>✏️ Edit</button>
                )}
                {canDeactivate && (
                  s.isActive ? (
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 3, color: "var(--rp-red)" }} onClick={() => handleDeactivate(s)}>🗑 Deactivate</button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: 3, color: "var(--rp-green)" }} onClick={() => handleReactivate(s)}>↩ Reactivate</button>
                  )
                )}
                {canDelete && (
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 3, color: "var(--rp-red)" }} onClick={() => handleDelete(s)}>❌ Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showAddModal && (
        <StaffFormModal onSaved={load} onClose={() => setShowAddModal(false)} />
      )}
      {editingStaff && (
        <StaffFormModal editingStaff={editingStaff} onSaved={load} onClose={() => setEditingStaff(null)} />
      )}
    </div>
  );
}
