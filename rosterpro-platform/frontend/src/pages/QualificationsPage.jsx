import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { listStaff } from "../api/staff.js";
import * as complianceApi from "../api/compliance.js";
import { getEntityHistory } from "../api/audit.js";
import { downloadReport } from "../api/reports.js";
import AddRecordModal from "../components/compliance/AddRecordModal.jsx";

const STATUS_STYLE = {
  VALID: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  EXPIRING: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  EXPIRED: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
};
const STATUS_DOT = { VALID: "var(--rp-green)", EXPIRING: "var(--amber)", EXPIRED: "var(--rp-red)" };
const CATEGORIES = ["B1", "B2", "CM", "NCS"];

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
const RECORD_TYPE_LABEL = { qualification: "Qualification", license: "License", training: "Training", authorization: "Authorization" };
// Real audit-trail entityType string each record type's create/update/delete
// calls are actually logged under (see complianceService.js) — used to pull
// each record's genuine change history for the History tab.
const ENTITY_TYPE = { qualification: "Qualification", license: "License", training: "Training", authorization: "StaffAuthorization" };

function recordsOf(summary, type) {
  if (!summary) return [];
  if (type === "qualification") return summary.qualifications.map(q => ({ record: q, label: q.qualCode, sub: q.description, expiry: q.expiryDate, issued: q.issuedDate, status: q.status }));
  if (type === "license") return summary.licenses.map(l => ({ record: l, label: `${l.category} — ${l.licenseNo}`, sub: l.issuingAuthority, expiry: l.expiryDate, issued: l.issuedDate, status: l.status }));
  if (type === "training") return summary.trainings.map(t => ({ record: t, label: t.courseName, sub: t.provider, expiry: t.validUntil, issued: t.completedDate, status: t.status }));
  if (type === "authorization") return summary.authorizations.map(a => ({ record: a, label: a.scope, sub: null, expiry: a.expiryDate, issued: a.grantedDate, status: a.status }));
  return [];
}
function allRecordsOf(summary) {
  return ["qualification", "license", "training", "authorization"].flatMap(t => recordsOf(summary, t).map(r => ({ ...r, type: t })));
}
function initials(name) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
}
function daysUntil(d) {
  return Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
}

export default function QualificationsPage() {
  const { hasPermission } = useAuth();
  const { stationId, currentStation } = useStation();
  const navigate = useNavigate();
  const [staffList, setStaffList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [summaries, setSummaries] = useState({}); // { [staffId]: complianceSummary }
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [showUpcomingAll, setShowUpcomingAll] = useState(false);
  const [showAddModal, setShowAddModal] = useState(null); // null | recordType string
  const [editingRecord, setEditingRecord] = useState(null); // { type, record } | null
  const [reportBusy, setReportBusy] = useState(false);
  const canEdit = hasPermission("qualification", "create");
  const canEditType = (type) => hasPermission(...EDIT_PERMISSION[type]);
  const canExport = hasPermission("reports", "export");

  usePageHeader({
    title: "Qualifications, Training & Authorisations",
    subtitle: "Manage staff qualifications, licenses, trainings and authorisations",
  });

  useEffect(() => {
    if (!stationId) return;
    setLoading(true);
    listStaff({ pageSize: 100, stationId }).then(d => {
      setStaffList(d.items);
      setSelectedId(sel => sel && d.items.some(s => s.id === sel) ? sel : (d.items.length ? d.items[0].id : null));
    }).finally(() => setLoading(false));
  }, [stationId]);

  // One compliance summary per staff member, station-wide — powers the left
  // pane's status dot for every row, not just the selected one. N parallel
  // calls to the same real per-staff endpoint; fine at this station-roster
  // scale (tens of staff).
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
      .then(lists => setHistory(lists.flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))))
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

  async function handleGenerateReport() {
    setReportBusy(true);
    try {
      await downloadReport("compliance", "excel", { stationId, userId: selectedId });
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setReportBusy(false);
    }
  }

  if (loading) return <div className="card">Loading staff…</div>;

  const selectedStaff = staffList.find(s => s.id === selectedId);
  const selectedSummary = summaries[selectedId];
  const searchLower = search.trim().toLowerCase();
  const filteredStaff = staffList.filter(s => {
    if (catFilter === "OTHERS" ? CATEGORIES.includes(s.category) : (catFilter !== "ALL" && s.category !== catFilter)) return false;
    if (searchLower && !s.fullName.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  const selectedAll = selectedSummary ? allRecordsOf(selectedSummary) : [];
  const totalRecords = selectedAll.length;
  const withExpiry = selectedAll.filter(r => r.expiry).sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
  const nextExpiry = withExpiry[0] || null;
  const validCount = selectedAll.filter(r => r.status === "VALID").length;
  const compliancePct = totalRecords > 0 ? Math.round((validCount / totalRecords) * 100) : 100;

  const TABS = [
    { key: "overview", label: "Overview" },
    { key: "qualification", label: `Qualifications (${recordsOf(selectedSummary, "qualification").length})` },
    { key: "license", label: `Licenses (${recordsOf(selectedSummary, "license").length})` },
    { key: "training", label: `Trainings (${recordsOf(selectedSummary, "training").length})` },
    { key: "authorization", label: `Authorisations (${recordsOf(selectedSummary, "authorization").length})` },
    { key: "history", label: "History" },
  ];

  return (
    <div style={{ display: "flex", gap: 14 }}>
      <div style={{ width: 260, flexShrink: 0 }}>
        <div className="card" style={{ padding: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Staff List ({staffList.length})</span>
          </div>
          <input className="fi" placeholder="🔍 Search staff…" value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[["ALL", "All"], ["B1", "B1"], ["B2", "B2"], ["CM", "CM"], ["NCS", "NCS"], ["OTHERS", "Others"]].map(([key, label]) => (
              <button
                key={key} onClick={() => setCatFilter(key)}
                className={`view-toggle-btn ${catFilter === key ? "active" : ""}`}
                style={{ fontSize: 10, padding: "4px 8px" }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "60vh", overflowY: "auto" }}>
          {filteredStaff.map(s => {
            const sum = summaries[s.id];
            const all = sum ? allRecordsOf(sum) : [];
            const dotColor = !sum ? "var(--text-dim)" : all.some(r => r.status === "EXPIRED") ? STATUS_DOT.EXPIRED : all.some(r => r.status === "EXPIRING") ? STATUS_DOT.EXPIRING : STATUS_DOT.VALID;
            return (
              <button
                key={s.id}
                onClick={() => { setSelectedId(s.id); setActiveTab("overview"); }}
                className="btn btn-ghost"
                style={{
                  display: "flex", alignItems: "center", gap: 8, textAlign: "left", justifyContent: "flex-start", padding: "8px 10px",
                  background: s.id === selectedId ? "var(--navy-lite)" : undefined,
                  borderColor: s.id === selectedId ? "var(--cyan)" : undefined,
                }}
              >
                <div className="u-avatar" style={{ width: 30, height: 30 }}>{initials(s.fullName)}</div>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.fullName}</div>
                  <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{s.designation || s.category || "—"}</div>
                </span>
                <span className={`cat-tag cat-${s.category || "NCS"}`}>{s.category || "NCS"}</span>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} title={sum?.isBlocked ? "Blocked" : ""} />
              </button>
            );
          })}
          {filteredStaff.length === 0 && <div className="empty-note">No staff match these filters.</div>}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {selectedStaff && selectedSummary ? (
          <>
            {selectedSummary.isBlocked && (
              <div className="ab red" style={{ marginBottom: 10 }}>
                🔒 {selectedStaff.fullName} has an expired qualification, license, training, or authorization and is currently blocked from full-scope duty.
              </div>
            )}

            <div className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div className="drawer-avatar" style={{ width: 54, height: 54, fontSize: 18 }}>{initials(selectedStaff.fullName)}</div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{selectedStaff.fullName}</div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                      {selectedStaff.designation || "—"} · Employee ID: {selectedStaff.employeeId || "—"} · <span className={`cat-tag cat-${selectedStaff.category || "NCS"}`}>{selectedStaff.category || "NCS"}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3, display: "flex", gap: 10 }}>
                      <span className="tag" style={{ background: selectedStaff.isActive ? "rgba(0,200,83,.12)" : "rgba(148,163,184,.15)", color: selectedStaff.isActive ? "var(--rp-green)" : "var(--text-dim)" }}>
                        {selectedStaff.isActive ? "Active" : "Inactive"}
                      </span>
                      {selectedStaff.email && <span>✉️ {selectedStaff.email}</span>}
                      {selectedStaff.phone && <span>📞 {selectedStaff.phone}</span>}
                    </div>
                  </div>
                </div>
                {canExport && (
                  <button className="btn btn-ghost btn-sm" disabled={reportBusy} onClick={handleGenerateReport}>
                    {reportBusy ? "Generating…" : "📊 Generate Report"}
                  </button>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 14 }}>
                <StatTile label="Base Station" value={currentStation ? currentStation.iataCode : "—"} sub={currentStation?.name} />
                <StatTile label="Total Records" value={totalRecords} sub="quals · licenses · training · auth" />
                <StatTile
                  label="Next Expiry" value={nextExpiry ? fmtDate(nextExpiry.expiry) : "—"}
                  sub={nextExpiry ? nextExpiry.label : "Nothing tracked"}
                  tone={nextExpiry ? (nextExpiry.status === "EXPIRED" ? "red" : nextExpiry.status === "EXPIRING" ? "amber" : "green") : "neutral"}
                />
                <StatTile label="Reports To" value={selectedStaff.reportsTo?.fullName || "—"} sub="L1 Manager" />
              </div>
            </div>

            <div className="card" style={{ marginBottom: 10 }}>
              <div className="view-toggle" style={{ flexWrap: "wrap" }}>
                {TABS.map(t => (
                  <button key={t.key} className={`view-toggle-btn ${activeTab === t.key ? "active" : ""}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
                ))}
              </div>
            </div>

            {activeTab === "overview" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 14 }}>
                  <OverviewCard icon="📜" title="Licenses" type="license" canEdit={canEditType("license")} records={recordsOf(selectedSummary, "license")} onAdd={() => setShowAddModal("license")} onEdit={setEditingRecord} onDelete={handleDelete} />
                  <OverviewCard icon="📚" title="Trainings" type="training" canEdit={canEditType("training")} records={recordsOf(selectedSummary, "training")} onAdd={() => setShowAddModal("training")} onEdit={setEditingRecord} onDelete={handleDelete} />
                  <OverviewCard icon="✅" title="Authorisations" type="authorization" canEdit={canEditType("authorization")} records={recordsOf(selectedSummary, "authorization")} onAdd={() => setShowAddModal("authorization")} onEdit={setEditingRecord} onDelete={handleDelete} />
                </div>

                <div className="card" style={{ marginBottom: 14 }}>
                  <div className="card-title">📈 Qualification Timeline</div>
                  <QualificationTimeline summary={selectedSummary} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 14 }}>
                  <div className="card">
                    <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>🛡 Compliance Status</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate("/compliance-rules")}>View Rules</button>
                    </div>
                    <ComplianceChecklist summary={selectedSummary} pct={compliancePct} />
                  </div>

                  <div className="card">
                    <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>⏰ Upcoming Expiry</span>
                      {withExpiry.length > 6 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowUpcomingAll(v => !v)}>{showUpcomingAll ? "Show Less" : "View All"}</button>
                      )}
                    </div>
                    <UpcomingExpiryTable items={showUpcomingAll ? withExpiry : withExpiry.slice(0, 6)} />
                  </div>
                </div>
              </>
            )}

            {["qualification", "license", "training", "authorization"].includes(activeTab) && (
              <div className="card">
                <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{RECORD_TYPE_LABEL[activeTab]}s</span>
                  {canEditType(activeTab) && <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(activeTab)}>＋ Add {RECORD_TYPE_LABEL[activeTab]}</button>}
                </div>
                <RecordList type={activeTab} records={recordsOf(selectedSummary, activeTab)} canEdit={canEditType(activeTab)} onEdit={setEditingRecord} onDelete={handleDelete} />
              </div>
            )}

            {activeTab === "history" && (
              <div className="card">
                <div className="card-title">🕐 Change History</div>
                {historyLoading ? <div className="empty-note">Loading history…</div> : !history || history.length === 0 ? (
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
                )}
              </div>
            )}
          </>
        ) : <div className="card">Select a staff member to view their compliance records.</div>}
      </div>

      {showAddModal && (
        <AddRecordModal userId={selectedId} initialType={showAddModal} onSaved={loadAllSummaries} onClose={() => setShowAddModal(null)} />
      )}
      {editingRecord && (
        <AddRecordModal userId={selectedId} editingRecord={editingRecord} onSaved={loadAllSummaries} onClose={() => setEditingRecord(null)} />
      )}
    </div>
  );
}

function StatTile({ label, value, sub, tone }) {
  const color = { red: "var(--rp-red)", amber: "var(--amber)", green: "var(--rp-green)" }[tone];
  return (
    <div style={{ background: "var(--navy-lite)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: .3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || "var(--white)" }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

function OverviewCard({ icon, title, records, canEdit, onAdd, onEdit, onDelete, type }) {
  return (
    <div className="card">
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{icon} {title}</span>
        {canEdit && <button className="btn btn-ghost btn-sm" onClick={onAdd}>＋ Add {title.replace(/s$/, "")}</button>}
      </div>
      {records.length === 0 ? (
        <div className="empty-note">No records.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          {records.slice(0, 3).map(r => (
            <div key={r.record.id} style={{ fontSize: 11 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 700 }}>{r.label}</span>
                <span className="tag" style={STATUS_STYLE[r.status] || {}}>{r.status}</span>
              </div>
              {r.sub && <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{r.sub}</div>}
              <div style={{ fontSize: 9, color: "var(--text-dim)", display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <span>Issue Date: {fmtDate(r.issued)}</span>
                <span>Expiry Date: {r.expiry ? fmtDate(r.expiry) : "No expiry"}</span>
              </div>
              {canEdit && (
                <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px" }} onClick={() => onEdit({ type, record: r.record })}>✏️ Edit</button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", color: "var(--rp-red)" }} onClick={() => onDelete(type, r.record, r.label)}>🗑️</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecordList({ type, records, canEdit, onEdit, onDelete }) {
  if (records.length === 0) return <div className="empty-note">No {RECORD_TYPE_LABEL[type].toLowerCase()} records.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {records.map(r => (
        <div key={r.record.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
          <span>{r.label}{r.sub ? <span style={{ color: "var(--text-dim)" }}> — {r.sub}</span> : null}</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "var(--text-dim)" }}>{r.expiry ? fmtDate(r.expiry) : "No expiry"}</span>
            <span className="tag" style={STATUS_STYLE[r.status] || {}}>{r.status}</span>
            {canEdit && (
              <>
                <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => onEdit({ type, record: r.record })}>✏️</button>
                <button className="btn btn-ghost btn-sm" title="Delete" style={{ color: "var(--rp-red)" }} onClick={() => onDelete(type, r.record, r.label)}>🗑️</button>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// A real horizontal timeline built from every issued/completed/granted date
// and every expiry date across all four record types — sorted
// chronologically, colored by what actually happened: green for a
// past issue/completion/grant, red for an already-expired item, amber for
// one expiring within 30 days, blue for a valid future expiry.
function QualificationTimeline({ summary }) {
  const events = useMemo(() => {
    const all = allRecordsOf(summary);
    const list = [];
    all.forEach(r => {
      if (r.issued) list.push({ date: r.issued, label: r.label, kind: r.type === "training" ? "Completed" : r.type === "authorization" ? "Granted" : "Issued", tone: "green" });
      if (r.expiry) {
        const days = daysUntil(r.expiry);
        list.push({
          date: r.expiry, label: r.label,
          kind: r.status === "EXPIRED" ? "Expired" : days <= 30 ? "Upcoming" : "Current",
          tone: r.status === "EXPIRED" ? "red" : days <= 30 ? "amber" : "blue",
        });
      }
    });
    return list.sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [summary]);

  if (events.length === 0) return <div className="empty-note">No dated compliance events yet.</div>;
  const colors = { green: "var(--rp-green)", red: "var(--rp-red)", amber: "var(--amber)", blue: "var(--sky)" };

  return (
    <div>
      <div style={{ display: "flex", gap: 14, fontSize: 9, color: "var(--text-dim)", marginBottom: 10 }}>
        {Object.entries({ green: "Completed", blue: "Current", amber: "Upcoming", red: "Expired" }).map(([tone, label]) => (
          <span key={tone} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: colors[tone], display: "inline-block" }} />{label}</span>
        ))}
      </div>
      <div style={{ display: "flex", overflowX: "auto", paddingBottom: 6, gap: 0 }}>
        {events.map((e, i) => (
          <div key={i} style={{ flex: "0 0 140px", position: "relative", textAlign: "center" }}>
            <div style={{ height: 2, background: "var(--border)", position: "absolute", top: 5, left: i === 0 ? "50%" : 0, right: i === events.length - 1 ? "50%" : 0 }} />
            <div style={{ width: 11, height: 11, borderRadius: "50%", background: colors[e.tone], margin: "0 auto", position: "relative", border: "2px solid var(--navy-mid)" }} />
            <div style={{ fontSize: 9, fontWeight: 700, marginTop: 6 }}>{fmtDate(e.date)}</div>
            <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{e.label}</div>
            <div style={{ fontSize: 8, color: colors[e.tone] }}>{e.kind}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComplianceChecklist({ summary, pct }) {
  const size = 110, strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct === 100 ? "var(--rp-green)" : pct >= 70 ? "var(--amber)" : "var(--rp-red)";

  const hasExpired = (list) => list.some(r => r.status === "EXPIRED");
  const checks = [
    { label: "Licenses valid", ok: !hasExpired(summary.licenses) },
    { label: "Training up to date", ok: !hasExpired(summary.trainings) },
    { label: "Authorisations valid", ok: !hasExpired(summary.authorizations) },
    { label: "No overdue items", ok: !summary.isBlocked },
  ];

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <div className="gauge-ring" style={{ width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(15,23,42,.08)" strokeWidth={strokeWidth} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <div className="gauge-ring-value" style={{ fontSize: 20, display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span>{pct}%</span>
          <span style={{ fontSize: 8, fontWeight: 500, color: "var(--text-dim)", textTransform: "none" }}>{pct === 100 ? "Compliant" : "Attention"}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {checks.map(c => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <span style={{ color: c.ok ? "var(--rp-green)" : "var(--rp-red)" }}>{c.ok ? "✓" : "✗"}</span>
            <span>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UpcomingExpiryTable({ items }) {
  if (items.length === 0) return <div className="empty-note">Nothing tracked with an expiry date.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="dc-table">
        <thead>
          <tr><th style={{ textAlign: "left" }}>Item</th><th style={{ textAlign: "left" }}>Type</th><th>Expiry Date</th><th>Days Left</th><th>Status</th></tr>
        </thead>
        <tbody>
          {items.map((r, i) => {
            const days = daysUntil(r.expiry);
            return (
              <tr key={i}>
                <td style={{ textAlign: "left" }}>{r.label}</td>
                <td style={{ textAlign: "left", color: "var(--text-dim)" }}>{RECORD_TYPE_LABEL[r.type]}</td>
                <td>{fmtDate(r.expiry)}</td>
                <td style={{ color: days < 0 ? "var(--rp-red)" : days <= 30 ? "var(--amber)" : "var(--text-dim)" }}>{days < 0 ? `${-days} overdue` : days}</td>
                <td><span className="tag" style={STATUS_STYLE[r.status] || {}}>{r.status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
