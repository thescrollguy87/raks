import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as staffApi from "../api/staff.js";
import { listLeave } from "../api/leave.js";
import { getDashboardSummary } from "../api/dashboard.js";
import StaffFormModal from "../components/staff/StaffFormModal.jsx";

const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const CAT_LABELS = { B1: "B1 AME", B2: "B2 AME", CM: "Certifying Mechanic", NCS: "NCS / Tech", STO: "Stores" };
const CAT_COLORS = { B1: "#3B82F6", B2: "#22D3EE", CM: "#A78BFA", NCS: "#34D399", STO: "#FBBF24" };
const ROLE_COLORS = ["#3B82F6", "#22D3EE", "#A78BFA", "#34D399", "#FBBF24", "#F472B6", "#94A3B8"];

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
  const [onLeaveToday, setOnLeaveToday] = useState(null);
  const [complianceIssues, setComplianceIssues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [roleFilter, setRoleFilter] = useState("ALL");

  const canCreate = hasPermission("staff", "create");
  const canUpdate = hasPermission("staff", "update");
  const canDeactivate = hasPermission("staff", "deactivate");
  const canDelete = hasPermission("staff", "delete");

  const load = useCallback(() => {
    if (!stationId) return;
    setError("");
    const todayIso = new Date().toISOString().slice(0, 10);
    Promise.all([
      staffApi.listStaff({ page: 1, pageSize: 100, stationId }),
      listLeave({ stationId, status: "APPROVED", from: todayIso, to: todayIso, pageSize: 100 }).catch(() => null),
      getDashboardSummary(stationId).catch(() => null),
    ])
      .then(([d, leave, summary]) => {
        setData(d);
        setOnLeaveToday(leave ? new Set(leave.items.map(l => l.userId)) : null);
        setComplianceIssues(summary ? summary.qualificationExpiry.qualifications.expired + summary.qualificationExpiry.licenses.expired : null);
      })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        { label: "Role not recognized (left unchanged)", items: r.roleWarnings },
        { label: "L1 Manager not found (left unchanged)", items: r.l1ManagerWarnings },
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
      // A 409 with details.forceable means the only things in the way are
      // clearable (current shift pattern/staff group/departure links) —
      // offer to clear them and delete anyway rather than just dead-ending
      // the admin at "deactivate instead". A non-forceable 409 (compliance/
      // audit-trail history) still just shows the message as-is.
      if (err.details?.forceable && err.details?.blockers?.length) {
        if (confirm(`${err.message}\n\nForce delete anyway? This will also clear: ${err.details.blockers.join(", ")}.`)) {
          try {
            await staffApi.deleteStaff(s.id, { force: true });
            load();
          } catch (err2) {
            alert(`Failed: ${err2.message}`);
          }
        }
        return;
      }
      alert(`Failed: ${err.message}`);
    }
  }

  if (loading) return <div className="card">Loading staff…</div>;
  if (error) return <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>;

  const allStaff = data.items;
  const activeCount = allStaff.filter(s => s.isActive).length;
  const inactiveCount = allStaff.length - activeCount;
  const now = new Date();
  const newThisMonthCount = allStaff.filter(s => {
    if (!s.createdAt) return false;
    const c = new Date(s.createdAt);
    return c.getFullYear() === now.getFullYear() && c.getMonth() === now.getMonth();
  }).length;
  const onLeaveTodayCount = onLeaveToday ? allStaff.filter(s => onLeaveToday.has(s.id)).length : null;

  const byCategory = {};
  CATEGORIES.forEach(c => { byCategory[c] = 0; });
  allStaff.forEach(s => { const c = s.category || "NCS"; byCategory[c] = (byCategory[c] || 0) + 1; });
  const maxCatCount = Math.max(1, ...Object.values(byCategory));

  const byRole = {};
  allStaff.forEach(s => s.roles.forEach(r => { byRole[r] = (byRole[r] || 0) + 1; }));
  const roleEntries = Object.entries(byRole).sort((a, b) => b[1] - a[1]);
  const maxRoleCount = Math.max(1, ...roleEntries.map(([, n]) => n));
  const allRoleNames = roleEntries.map(([r]) => r);

  const recentlyAdded = [...allStaff]
    .filter(s => s.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  const searchLower = search.trim().toLowerCase();
  const filtered = allStaff.filter(s => {
    if (statusFilter === "ACTIVE" && !s.isActive) return false;
    if (statusFilter === "INACTIVE" && s.isActive) return false;
    if (catFilter !== "ALL" && (s.category || "NCS") !== catFilter) return false;
    if (roleFilter !== "ALL" && !s.roles.includes(roleFilter)) return false;
    if (searchLower) {
      const hay = `${s.fullName} ${s.employeeId || ""} ${s.email} ${s.designation || ""}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KpiCard tone="sky" icon="👥" label="Total Staff" value={allStaff.length} sub="At this station" />
        <KpiCard tone="green" icon="✅" label="Active" value={activeCount} sub={inactiveCount > 0 ? `${inactiveCount} inactive` : "All active"} />
        <KpiCard tone={onLeaveTodayCount ? "amber" : "neutral"} icon="🏖" label="On Leave Today" value={onLeaveTodayCount ?? "—"} sub="Approved leave" />
        <KpiCard tone={newThisMonthCount > 0 ? "sky" : "neutral"} icon="🆕" label="New This Month" value={newThisMonthCount} sub={now.toLocaleDateString(undefined, { month: "long" })} />
        <KpiCard tone={complianceIssues ? "red" : "neutral"} icon="⚠️" label="Compliance Issues" value={complianceIssues ?? "—"} sub={complianceIssues ? "Expired quals/licenses" : "All up to date"} />
      </div>

      {/* Search + filter bar */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="fg" style={{ flex: "2 1 220px" }}>
            <label className="fl">Search</label>
            <input className="fi" placeholder="Name, employee ID, email, designation…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="fg" style={{ flex: "1 1 130px" }}>
            <label className="fl">Category</label>
            <select className="fi" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="ALL">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c} — {CAT_LABELS[c]}</option>)}
            </select>
          </div>
          <div className="fg" style={{ flex: "1 1 130px" }}>
            <label className="fl">Status</label>
            <select className="fi" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <div className="fg" style={{ flex: "1 1 150px" }}>
            <label className="fl">Role</label>
            <select className="fi" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="ALL">All Roles</option>
              {allRoleNames.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">
          Staff Registry <span className="tag">{filtered.length} of {allStaff.length}</span>
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
        {filtered.length === 0 ? (
          <div className="empty-note">No staff match these filters.</div>
        ) : CATEGORIES.map(cat => {
          const rows = filtered.filter(s => (s.category || "NCS") === cat);
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
                      <td style={{ textAlign: "left", padding: "6px 4px" }}>
                        {s.fullName}
                        {onLeaveToday?.has(s.id) && <span className="tag" style={{ marginLeft: 6, background: "rgba(245,166,35,.15)", color: "var(--amber)" }}>On Leave</span>}
                      </td>
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
      </div>

      {/* Bottom widgets: By Category / By Role / Recently Added */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <Widget title="👥 Staff by Category">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {CATEGORIES.map(cat => (
              <div className="cov-row" key={cat}>
                <span className="cov-row-label"><span className={`tag cat-${cat}`}>{cat}</span></span>
                <div className="cov-row-track">
                  <div className="cov-row-fill" style={{ width: `${byCategory[cat] === 0 ? 0 : Math.max(6, (byCategory[cat] / maxCatCount) * 100)}%`, background: CAT_COLORS[cat] }} />
                </div>
                <span className="cov-row-val">{byCategory[cat]}</span>
              </div>
            ))}
          </div>
        </Widget>

        <Widget title="🛡 Staff by Role">
          {roleEntries.length === 0 ? <div className="empty-note">No roles assigned.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {roleEntries.map(([role, n], i) => (
                <div className="cov-row" key={role}>
                  <span className="cov-row-label" style={{ fontSize: 10, width: 130 }}>{role}</span>
                  <div className="cov-row-track">
                    <div className="cov-row-fill" style={{ width: `${Math.max(6, (n / maxRoleCount) * 100)}%`, background: ROLE_COLORS[i % ROLE_COLORS.length] }} />
                  </div>
                  <span className="cov-row-val">{n}</span>
                </div>
              ))}
            </div>
          )}
        </Widget>

        <Widget title="🆕 Recently Added">
          {recentlyAdded.length === 0 ? <div className="empty-note">No staff records yet.</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {recentlyAdded.map(s => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      <span className={`cat-tag cat-${s.category || "NCS"}`} style={{ marginRight: 5 }}>{s.category || "NCS"}</span>
                      {s.fullName}
                    </div>
                    <div style={{ color: "var(--text-dim)", fontSize: 10 }}>{s.designation || "—"}</div>
                  </div>
                  <span className="tag">{fmtDate(s.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Widget>
      </div>

      {showAddModal && (
        <StaffFormModal onSaved={load} onClose={() => setShowAddModal(false)} />
      )}
      {editingStaff && (
        <StaffFormModal editingStaff={editingStaff} onSaved={load} onClose={() => setEditingStaff(null)} />
      )}
    </div>
  );
}

function KpiCard({ tone, icon, label, value, sub }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Widget({ title, children }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "—";
}
