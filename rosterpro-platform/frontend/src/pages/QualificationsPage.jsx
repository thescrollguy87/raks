import { useState, useEffect, useCallback, useMemo } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { listStaff } from "../api/staff.js";
import * as complianceApi from "../api/compliance.js";
import AddRecordModal from "../components/compliance/AddRecordModal.jsx";

const STATUS_STYLE = {
  VALID: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  EXPIRING: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  EXPIRED: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
};

export default function QualificationsPage() {
  const { hasPermission } = useAuth();
  const [staffList, setStaffList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const canEdit = hasPermission("qualification", "create");

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
    subtitle: "AMD · Compliance records",
    actions: headerActions,
  });

  useEffect(() => {
    listStaff({ pageSize: 100 }).then(d => {
      setStaffList(d.items);
      if (d.items.length) setSelectedId(d.items[0].id);
    }).finally(() => setLoading(false));
  }, []);

  const loadSummary = useCallback(() => {
    if (!selectedId) return;
    complianceApi.getComplianceSummary(selectedId).then(setSummary);
  }, [selectedId]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  if (loading) return <div className="card">Loading staff…</div>;

  const selectedStaff = staffList.find(s => s.id === selectedId);

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <div style={{ width: 220, flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", marginBottom: 7 }}>SELECT STAFF</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: "70vh", overflowY: "auto" }}>
          {staffList.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className="btn btn-ghost"
              style={{
                textAlign: "left", justifyContent: "flex-start",
                background: s.id === selectedId ? "var(--navy-lite)" : undefined,
                borderColor: s.id === selectedId ? "var(--cyan)" : undefined,
              }}
            >
              <span className={`cat-tag cat-${s.category || "NCS"}`} style={{ marginRight: 6 }}>{s.category || "NCS"}</span>
              {s.fullName}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        {selectedStaff && summary ? (
          <>
            {summary.isBlocked && (
              <div className="ab red" style={{ marginBottom: 10 }}>
                🔒 {selectedStaff.fullName} has an expired qualification or license and is currently blocked from full-scope duty.
              </div>
            )}
            <RecordSection title="🎓 Qualifications" records={summary.qualifications.map(q => ({
              label: q.qualCode, expiry: q.expiryDate, status: q.status,
            }))} />
            <RecordSection title="📜 Licenses" records={summary.licenses.map(l => ({
              label: `${l.category} — ${l.licenseNo}`, expiry: l.expiryDate, status: l.status,
            }))} />
            <RecordSection title="📚 Training" records={summary.trainings.map(t => ({
              label: t.courseName, expiry: t.validUntil, status: t.status,
            }))} />
            <RecordSection title="✅ Authorizations" records={summary.authorizations.map(a => ({
              label: a.scope, expiry: a.expiryDate, status: a.status,
            }))} />
          </>
        ) : <div className="card">Select a staff member to view their compliance records.</div>}
      </div>

      {showAddModal && (
        <AddRecordModal userId={selectedId} onSaved={loadSummary} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}

function RecordSection({ title, records }) {
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-title">{title} <span className="tag">{records.length}</span></div>
      {records.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>No records.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {records.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
              <span>{r.label}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "var(--text-dim)" }}>{r.expiry ? new Date(r.expiry).toISOString().slice(0, 10) : "No expiry"}</span>
                <span className="tag" style={STATUS_STYLE[r.status] || {}}>{r.status}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
