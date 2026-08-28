import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as staffApi from "../api/staff.js";
import StaffFormModal from "../components/staff/StaffFormModal.jsx";

const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const CAT_LABELS = { B1: "B1 AME", B2: "B2 AME", CM: "Certifying Mechanic", NCS: "NCS / Tech", STO: "Stores" };

// Same hidden-input-plus-button trigger ImportExportPage.jsx uses — kept
// page-local rather than shared since it's a few lines and this is the
// only other place that needs it.
function FileImportButton({ label, busy, onFile }) {
  const ref = useRef(null);
  function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onFile(file);
  }
  return (
    <>
      <input ref={ref} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleChange} />
      <button className="btn btn-ghost" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "Importing…" : label}
      </button>
    </>
  );
}

export default function StaffPage() {
  const { hasPermission } = useAuth();
  const { stationId, currentStation } = useStation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const canCreate = hasPermission("staff", "create");
  const canUpdate = hasPermission("staff", "update");
  const canDeactivate = hasPermission("staff", "deactivate");
  const canDelete = hasPermission("staff", "delete");

  const load = useCallback(() => {
    if (!stationId) return;
    setError("");
    staffApi.listStaff({ page: 1, pageSize: 100, stationId })
      .then(d => setData(d))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [stationId]);

  useEffect(() => { load(); }, [load]);

  // Memoized — see RosterPage.jsx for why: usePageHeader re-syncs whenever
  // `actions` changes reference, and this component re-renders on every
  // header-context update, so a fresh JSX element here every render would
  // loop the two forever.
  const headerActions = useMemo(() => (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {canUpdate && (
        <>
          <button className="btn btn-ghost" onClick={() => staffApi.downloadEmployeeMasterTemplate()}>⬇ Download Template</button>
          <button className="btn btn-ghost" onClick={() => staffApi.exportEmployeeMaster(stationId)}>⬇ Export</button>
          <FileImportButton label="⬆ Import" busy={importBusy} onFile={handleImport} />
        </>
      )}
      {canCreate && <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>＋ Add Staff</button>}
    </div>
  ), [canCreate, canUpdate, stationId, importBusy]);

  usePageHeader({ title: "Staff Registry", subtitle: currentStation ? `${currentStation.name} Line Maintenance` : "", actions: headerActions });

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

  // Reuses the Employee Master import/export logic (staffApi.*) rather than
  // duplicating it — same Category column, same Location matching, same
  // "never creates a new login" behavior, just triggered from the station's
  // own registry screen instead of the Import/Export tab.
  async function handleImport(file) {
    if (!stationId) return;
    setImportBusy(true); setImportResult(null);
    try {
      const r = await staffApi.importEmployeeMaster(stationId, file);
      const lists = [
        { label: "Not matched to any staff at this station", items: r.notFound },
        { label: "Skipped — Location didn't match this station", items: r.stationMismatch },
        { label: "Row errors", items: r.rowErrors },
        { label: "Duplicate rows in file", items: r.duplicates },
      ];
      setImportResult({ tone: "green", headline: `${r.updated} staff record(s) updated.`, lists });
      load();
    } catch (err) {
      setImportResult({ tone: "red", headline: err.message, lists: [{ label: "Details", items: err.details || [] }] });
    } finally {
      setImportBusy(false);
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
      {importResult && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              padding: "8px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: importResult.tone === "red" ? "rgba(229,57,53,.12)" : "rgba(0,200,83,.1)",
              color: importResult.tone === "red" ? "var(--rp-red)" : "var(--rp-green)",
            }}
          >
            {importResult.headline}
          </div>
          {(importResult.lists || []).filter(l => l.items?.length).map(l => (
            <div key={l.label} style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
              <strong>{l.label}:</strong> {l.items.slice(0, 8).join("; ")}{l.items.length > 8 ? ` … +${l.items.length - 8} more` : ""}
            </div>
          ))}
        </div>
      )}
      {CATEGORIES.map(cat => {
        const rows = data.items.filter(s => (s.category || "NCS") === cat);
        if (!rows.length) return null;
        return (
          <div key={cat} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 1, margin: "10px 0 6px", display: "flex", alignItems: "center", gap: 6 }}>
              <span className={`cat-tag cat-${cat}`}>{cat}</span> {CAT_LABELS[cat]} · {rows.length} staff
            </div>
            <table className="rt" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Name</th>
                  <th style={{ textAlign: "left" }}>Employee ID</th>
                  <th style={{ textAlign: "left" }}>Email</th>
                  <th style={{ textAlign: "left" }}>Designation</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.id} style={!s.isActive ? { opacity: 0.6 } : undefined}>
                    <td style={{ textAlign: "left", padding: "6px 4px" }}>{s.fullName}</td>
                    <td style={{ textAlign: "left", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)" }}>{s.employeeId || "—"}</td>
                    <td style={{ textAlign: "left", fontSize: 10, color: "var(--text-dim)" }}>{s.email}</td>
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
          </div>
        );
      })}

      {showAddModal && (
        <StaffFormModal onSaved={load} onClose={() => setShowAddModal(false)} />
      )}
      {editingStaff && (
        <StaffFormModal editingStaff={editingStaff} onSaved={load} onClose={() => setEditingStaff(null)} />
      )}
    </div>
  );
}
