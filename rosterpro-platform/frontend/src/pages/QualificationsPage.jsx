import { useState, useEffect, useCallback, useMemo } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { listStaff } from "../api/staff.js";
import * as complianceApi from "../api/compliance.js";
import { getEntityHistory } from "../api/audit.js";
import AddRecordModal from "../components/compliance/AddRecordModal.jsx";

const STATUS_STYLE = {
  VALID: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  EXPIRING: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  EXPIRED: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
};
const STATUS_COLORS = { VALID: "#22C55E", EXPIRING: "#FBBF24", EXPIRED: "#E53935" };

// Which permission (resource, action) gates editing/deleting each record
// type — authorizations reuse the "qualification" permission namespace,
// same as their create/read endpoints already do (see complianceRoutes.js).
const EDIT_PERMISSION = {
  qualification: ["qualification", "update"],
  license: ["license", "update"],
  training: ["training", "update"],
  authorization: ["qualification", "update"],
};

const DELETE_API = {
  qualification: complianceApi.deleteQualification,
  license: complianceApi.deleteLicense,
  training: complianceApi.deleteTraining,
  authorization: complianceApi.deleteAuthorization,
};

const RECORD_TYPE_LABEL = {
  qualification: "Qualification", license: "License", training: "Training", authorization: "Authorization",
};
// Real audit-trail entityType string each record type's create/update/delete
// calls are actually logged under (see complianceService.js) — used to pull
// each record's genuine change history for the timeline tab, rather than
// inventing a synthetic one.
const ENTITY_TYPE = {
  qualification: "Qualification", license: "License", training: "Training", authorization: "StaffAuthorization",
};

const TABS = [
  { key: "qualification", label: "🎓 Qualifications" },
  { key: "license", label: "📜 Licenses" },
  { key: "training", label: "📚 Training" },
  { key: "authorization", label: "✅ Authorizations" },
  { key: "history", label: "🕐 History" },
];

function recordsOf(summary, type) {
  if (!summary) return [];
  if (type === "qualification") return summary.qualifications.map(q => ({ record: q, label: q.qualCode, expiry: q.expiryDate, status: q.status }));
  if (type === "license") return summary.licenses.map(l => ({ record: l, label: `${l.category} — ${l.licenseNo}`, expiry: l.expiryDate, status: l.status }));
  if (type === "training") return summary.trainings.map(t => ({ record: t, label: t.courseName, expiry: t.validUntil, status: t.status }));
  if (type === "authorization") return summary.authorizations.map(a => ({ record: a, label: a.scope, expiry: a.expiryDate, status: a.status }));
  return [];
}

function allRecordsOf(summary) {
  return ["qualification", "license", "training", "authorization"].flatMap(t => recordsOf(summary, t).map(r => ({ ...r, type: t })));
}

export default function QualificationsPage() {
  const { hasPermission } = useAuth();
  const { stationId, currentStation } = useStation();
  const [staffList, setStaffList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [summaries, setSummaries] = useState({}); // { [staffId]: complianceSummary }
  const [history, setHistory] = useState(null); // merged audit-trail rows for selectedId
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("qualification");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null); // { type, record } | null
  const canEdit = hasPermission("qualification", "create");
  const canEditType = (type) => hasPermission(...EDIT_PERMISSION[type]);

  // Memoized: usePageHeader re-syncs whenever `actions` changes reference,
  // and this component re-renders on every header-context update — a fresh
  // JSX element here every render would loop the two forever.
  const headerActions = useMemo(() => (
    canEdit && selectedId ? (
      <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>＋ Add Record</button>
    ) : null
  ), [canEdit, selectedId]);

  usePageHeader({
    title: "Qualifications, Training & Authorisations",
    subtitle: currentStation ? `${currentStation.iataCode} · Compliance records` : "",
    actions: headerActions,
  });

  useEffect(() => {
    if (!stationId) return;
    setLoading(true);
    listStaff({ pageSize: 100, stationId }).then(d => {
      setStaffList(d.items);
      setSelectedId(sel => sel && d.items.some(s => s.id === sel) ? sel : (d.items.length ? d.items[0].id : null));
    }).finally(() => setLoading(false));
  }, [stationId]);

  // One compliance summary per staff member, station-wide — powers the KPI
  // row and per-row badges in the left pane, not just the selected person.
  // N parallel calls to the same real per-staff endpoint the old page used
  // one-at-a-time; fine at this station-roster scale (tens of staff).
  const loadAllSummaries = useCallback(() => {
    if (staffList.length === 0) return;
    Promise.all(staffList.map(s => complianceApi.getComplianceSummary(s.id).then(sum => [s.id, sum])))
      .then(pairs => setSummaries(Object.fromEntries(pairs)));
  }, [staffList]);

  useEffect(() => { loadAllSummaries(); }, [loadAllSummaries]);

  const loadHistory = useCallback(() => {
    if (!selectedId || !summaries[selectedId]) { setHistory(null); return; }
    setHistoryLoading(true);
    const records = allRecordsOf(summaries[selectedId]);
    Promise.all(records.map(r => getEntityHistory(ENTITY_TYPE[r.type], r.record.id).then(rows => rows.map(row => ({ ...row, _label: r.label })))))
      .then(lists => {
        const merged = lists.flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        setHistory(merged);
      })
      .finally(() => setHistoryLoading(false));
  }, [selectedId, summaries]);

  useEffect(() => { if (activeTab === "history") loadHistory(); }, [activeTab, loadHistory]);

  async function handleDelete(type, record, label) {
    if (!confirm(`Delete this ${RECORD_TYPE_LABEL[type]} record — "${label}"?\n\nThis cannot be undone.`)) return;
    try {
      await DELETE_API[type](record.id);
      loadAllSummaries();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  if (loading) return <div className="card">Loading staff…</div>;

  const selectedStaff = staffList.find(s => s.id === selectedId);
  const selectedSummary = summaries[selectedId];

  // Station-wide compliance totals across every staff member's every
  // record — the real basis for the KPI row and the page-level donut.
  let totalRecords = 0, validCount = 0, expiringCount = 0, expiredCount = 0, blockedStaffCount = 0;
  Object.values(summaries).forEach(sum => {
    if (sum.isBlocked) blockedStaffCount++;
    allRecordsOf(sum).forEach(r => {
      totalRecords++;
      if (r.status === "VALID") validCount++;
      else if (r.status === "EXPIRING") expiringCount++;
      else if (r.status === "EXPIRED") expiredCount++;
    });
  });
  const summariesLoaded = Object.keys(summaries).length > 0 || staffList.length === 0;

  const searchLower = search.trim().toLowerCase();
  const filteredStaff = staffList.filter(s => {
    if (catFilter !== "ALL" && (s.category || "NCS") !== catFilter) return false;
    if (searchLower && !s.fullName.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  const activeRecords = selectedSummary ? recordsOf(selectedSummary, activeTab) : [];
  const selectedAllRecords = selectedSummary ? allRecordsOf(selectedSummary) : [];
  const selectedValid = selectedAllRecords.filter(r => r.status === "VALID").length;
  const selectedExpiring = selectedAllRecords.filter(r => r.status === "EXPIRING").length;
  const selectedExpired = selectedAllRecords.filter(r => r.status === "EXPIRED").length;

  return (
    <div>
      {/* Station-wide KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KpiCard tone="sky" icon="📋" label="Total Records" value={summariesLoaded ? totalRecords : "—"} sub="Quals, licenses, training, auth" />
        <KpiCard tone="green" icon="✅" label="Valid" value={summariesLoaded ? validCount : "—"} sub="Up to date" />
        <KpiCard tone={expiringCount > 0 ? "amber" : "neutral"} icon="⏰" label="Expiring" value={summariesLoaded ? expiringCount : "—"} sub="Within 30 days" />
        <KpiCard tone={expiredCount > 0 ? "red" : "neutral"} icon="🔴" label="Expired" value={summariesLoaded ? expiredCount : "—"} sub="Needs renewal" />
        <KpiCard tone={blockedStaffCount > 0 ? "red" : "neutral"} icon="🔒" label="Staff Blocked" value={summariesLoaded ? blockedStaffCount : "—"} sub="Full-scope duty blocked" />
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        <div style={{ width: 260, flexShrink: 0 }}>
          <div className="card" style={{ marginBottom: 10, padding: 10 }}>
            <input className="fi" placeholder="Search staff…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 7 }} />
            <select className="fi" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="ALL">All Categories</option>
              {["B1", "B2", "CM", "NCS", "STO"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", marginBottom: 7 }}>SELECT STAFF ({filteredStaff.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "60vh", overflowY: "auto" }}>
            {filteredStaff.map(s => {
              const sum = summaries[s.id];
              const badgeCount = sum ? allRecordsOf(sum).filter(r => r.status !== "VALID").length : 0;
              return (
                <button
                  key={s.id}
                  onClick={() => { setSelectedId(s.id); setActiveTab("qualification"); }}
                  className="btn btn-ghost"
                  style={{
                    textAlign: "left", justifyContent: "space-between", display: "flex", alignItems: "center",
                    background: s.id === selectedId ? "var(--navy-lite)" : undefined,
                    borderColor: s.id === selectedId ? "var(--cyan)" : undefined,
                  }}
                >
                  <span><span className={`cat-tag cat-${s.category || "NCS"}`} style={{ marginRight: 6 }}>{s.category || "NCS"}</span>{s.fullName}</span>
                  {sum?.isBlocked ? <span title="Blocked">🔒</span> : badgeCount > 0 ? <span className="metric-badge amber" style={{ padding: "1px 6px" }}>{badgeCount}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedStaff && selectedSummary ? (
            <>
              {selectedSummary.isBlocked && (
                <div className="ab red" style={{ marginBottom: 10 }}>
                  🔒 {selectedStaff.fullName} has an expired qualification or license and is currently blocked from full-scope duty.
                </div>
              )}

              <div className="card" style={{ marginBottom: 10 }}>
                <div className="card-title">{selectedStaff.fullName} — Compliance Overview</div>
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 6, flexWrap: "wrap" }}>
                  <ComplianceDonut valid={selectedValid} expiring={selectedExpiring} expired={selectedExpired} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--text-dim)" }}>
                    <div>{selectedStaff.designation || "—"}</div>
                    <div>{selectedAllRecords.length} record(s) total</div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="view-toggle" style={{ marginBottom: 12, flexWrap: "wrap" }}>
                  {TABS.map(t => (
                    <button
                      key={t.key} className={`view-toggle-btn ${activeTab === t.key ? "active" : ""}`}
                      onClick={() => setActiveTab(t.key)}
                    >
                      {t.label}{t.key !== "history" ? ` (${recordsOf(selectedSummary, t.key).length})` : ""}
                    </button>
                  ))}
                </div>

                {activeTab === "history" ? (
                  historyLoading ? <div className="empty-note">Loading history…</div> : !history || history.length === 0 ? (
                    <div className="empty-note">No change history recorded for this staff member's compliance records.</div>
                  ) : (
                    <div className="timeline">
                      {history.slice(0, 30).map(h => (
                        <div className="tl-item" key={h.id}>
                          <div className={`tl-dot ${h.action === "DELETE" ? "alert" : h.action === "CREATE" ? "created" : "change"}`} />
                          <div className="tl-content">
                            <div className="tl-hdr">
                              <span className="tl-user">{h.action} · {h._label}</span>
                              <span className="tl-ts">{new Date(h.timestamp).toLocaleString()}</span>
                            </div>
                            <div className="tl-action">
                              {h.fieldName ? `${h.fieldName}: ${h.oldValue ?? "—"} → ${h.newValue ?? "—"}` : (h.reason || "—")}
                              {h.changedByName ? ` · by ${h.changedByName}` : ""}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : activeRecords.length === 0 ? (
                  <div className="empty-note">No {RECORD_TYPE_LABEL[activeTab].toLowerCase()} records.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {activeRecords.map(r => (
                      <div key={r.record.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                        <span>{r.label}</span>
                        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ color: "var(--text-dim)" }}>{r.expiry ? new Date(r.expiry).toISOString().slice(0, 10) : "No expiry"}</span>
                          <span className="tag" style={STATUS_STYLE[r.status] || {}}>{r.status}</span>
                          {canEditType(activeTab) && (
                            <>
                              <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditingRecord({ type: activeTab, record: r.record })}>✏️</button>
                              <button className="btn btn-ghost btn-sm" title="Delete" style={{ color: "var(--rp-red)" }} onClick={() => handleDelete(activeTab, r.record, r.label)}>🗑️</button>
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : <div className="card">Select a staff member to view their compliance records.</div>}
        </div>
      </div>

      {showAddModal && (
        <AddRecordModal userId={selectedId} onSaved={loadAllSummaries} onClose={() => setShowAddModal(false)} />
      )}
      {editingRecord && (
        <AddRecordModal userId={selectedId} editingRecord={editingRecord} onSaved={loadAllSummaries} onClose={() => setEditingRecord(null)} />
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

// Compact 3-segment donut (Valid / Expiring / Expired) for one staff
// member's own records — same segmented-circle technique as the
// Dashboard's Shift Distribution donut, sized down for an inline card.
function ComplianceDonut({ valid, expiring, expired }) {
  const total = valid + expiring + expired;
  const size = 84, strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const entries = [
    { key: "VALID", label: "Valid", value: valid },
    { key: "EXPIRING", label: "Expiring", value: expiring },
    { key: "EXPIRED", label: "Expired", value: expired },
  ];
  let offsetAccum = 0;
  const segments = entries.filter(e => e.value > 0).map(e => {
    const frac = total > 0 ? e.value / total : 0;
    const len = frac * circumference;
    const seg = { ...e, dasharray: `${len} ${circumference - len}`, dashoffset: -offsetAccum };
    offsetAccum += len;
    return seg;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div className="gauge-ring" style={{ width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(15,23,42,.06)" strokeWidth={strokeWidth} />
          {segments.map(s => (
            <circle
              key={s.key} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={STATUS_COLORS[s.key]} strokeWidth={strokeWidth}
              strokeDasharray={s.dasharray} strokeDashoffset={s.dashoffset}
            />
          ))}
        </svg>
        <div className="gauge-ring-value" style={{ fontSize: 15 }}>{total}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map(e => (
          <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLORS[e.key], display: "inline-block" }} />
            <span style={{ color: "var(--text-dim)", minWidth: 46 }}>{e.label}</span>
            <span style={{ fontWeight: 700 }}>{e.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
