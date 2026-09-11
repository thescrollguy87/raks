import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as auditApi from "../api/audit.js";
import * as staffApi from "../api/staff.js";

// Every entityType string actually passed to auditTrail.recordCreate/
// recordUpdate/recordDelete across the backend — kept as a flat list here
// rather than a new endpoint, since it rarely changes and a station
// manager filtering "show me roster changes" doesn't need it to be
// perfectly dynamic.
const ENTITY_TYPES = [
  "ShiftAssignment", "Roster", "RosterVersion", "ImportJob", "User", "Station", "Airline",
  "Leave", "License", "Qualification", "Training", "StaffAuthorization", "ShiftDefinition",
  "Flight", "EngineeringDelay",
];

export default function ChangeHistoryPage() {
  const [tab, setTab] = useState("feed"); // feed | detailed
  usePageHeader({ title: "Change History", subtitle: "Recent activity across the platform" });

  return (
    <div>
      <div className="view-toggle" style={{ marginBottom: 14, width: "fit-content" }}>
        <button className={`view-toggle-btn${tab === "feed" ? " active" : ""}`} onClick={() => setTab("feed")}>Activity Feed</button>
        <button className={`view-toggle-btn${tab === "detailed" ? " active" : ""}`} onClick={() => setTab("detailed")}>Detailed Changes</button>
      </div>
      {tab === "feed" ? <ActivityFeedTab /> : <DetailedChangesTab />}
    </div>
  );
}

function ActivityFeedTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    auditApi.listActivity({ pageSize: 100 })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card">Loading activity…</div>;
  if (error) return <div className="ab red">{error}</div>;

  return (
    <div className="card">
      <div className="card-title">Activity Feed <span className="tag">{data.total} entries</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
        {data.items.map(item => (
          <div key={item.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            padding: "7px 4px", borderBottom: "1px solid var(--border)", fontSize: 11,
          }}>
            <div>
              <strong>{item.action}</strong>
              {item.detail && <span style={{ color: "var(--text-dim)" }}> — {item.detail}</span>}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0, marginLeft: 10 }}>
              <span style={{ color: "var(--text-dim)" }}>{item.user?.fullName || "System"}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 10 }}>
                {new Date(item.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        ))}
        {data.items.length === 0 && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No activity recorded yet.</div>}
      </div>
    </div>
  );
}

// Field-level audit trail — every changed field, old value -> new value,
// who/when/where/why. All filtering (date, user, action/entity, station)
// is real server-side filtering through the existing GET /api/audit/trail
// endpoint (already station-scoped server-side for anyone but an
// airline-wide role — see backend/src/controllers/auditController.js);
// this page just exposes filters that endpoint already supported but the
// old single-feed view never surfaced.
function DetailedChangesTab() {
  const { stations } = useStation();
  const [staffOptions, setStaffOptions] = useState([]);
  const [filters, setFilters] = useState({ from: "", to: "", entityType: "", changedById: "", stationId: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    staffApi.listStaff({ pageSize: 500 }).then(r => setStaffOptions(r.items || r || [])).catch(() => setStaffOptions([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const params = { page, pageSize: 50 };
    if (filters.from) params.from = new Date(filters.from + "T00:00:00.000Z").toISOString();
    if (filters.to) params.to = new Date(filters.to + "T23:59:59.999Z").toISOString();
    if (filters.entityType) params.entityType = filters.entityType;
    if (filters.changedById) params.changedById = filters.changedById;
    if (filters.stationId) params.stationId = filters.stationId;
    auditApi.listAuditTrail(params)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  function updateFilter(key, value) {
    setPage(1);
    setFilters(f => ({ ...f, [key]: value }));
  }

  return (
    <div className="card">
      <div className="card-title">Detailed Changes {data && <span className="tag">{data.total} entries</span>}</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0" }}>
        <div className="fg" style={{ maxWidth: 150 }}>
          <label className="fl">From</label>
          <input className="fi" type="date" value={filters.from} onChange={(e) => updateFilter("from", e.target.value)} />
        </div>
        <div className="fg" style={{ maxWidth: 150 }}>
          <label className="fl">To</label>
          <input className="fi" type="date" value={filters.to} onChange={(e) => updateFilter("to", e.target.value)} />
        </div>
        <div className="fg" style={{ maxWidth: 180 }}>
          <label className="fl">Entity / Action</label>
          <select className="fi" value={filters.entityType} onChange={(e) => updateFilter("entityType", e.target.value)}>
            <option value="">All</option>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="fg" style={{ maxWidth: 200 }}>
          <label className="fl">User</label>
          <select className="fi" value={filters.changedById} onChange={(e) => updateFilter("changedById", e.target.value)}>
            <option value="">All</option>
            {staffOptions.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>
        {stations.length > 1 && (
          <div className="fg" style={{ maxWidth: 180 }}>
            <label className="fl">Station</label>
            <select className="fi" value={filters.stationId} onChange={(e) => updateFilter("stationId", e.target.value)}>
              <option value="">All (my airline)</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.iataCode} — {s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {error && <div className="ab red">{error}</div>}
      {loading ? (
        <div className="empty-note">Loading…</div>
      ) : !data || data.items.length === 0 ? (
        <div className="empty-note">No changes match these filters.</div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {data.items.map(row => {
              const isOpen = expandedId === row.id;
              return (
                <div key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <div
                    onClick={() => setExpandedId(isOpen ? null : row.id)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 4px", fontSize: 11, cursor: "pointer" }}
                  >
                    <div>
                      <span style={{ fontWeight: 700 }}>{isOpen ? "▼" : "▶"} {row.entityType}</span>
                      <span style={{ color: "var(--text-dim)" }}> · {row.action}{row.fieldName ? ` · ${row.fieldName}` : ""}</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0, marginLeft: 10 }}>
                      <span style={{ color: "var(--text-dim)" }}>{row.changedByName || "System"}</span>
                      <span style={{ color: "var(--text-dim)", fontSize: 10 }}>
                        {new Date(row.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "4px 4px 10px 20px", fontSize: 10, color: "var(--text-dim)", display: "flex", flexDirection: "column", gap: 3 }}>
                      {row.oldValue !== null && row.oldValue !== undefined && (
                        <div><strong>Old:</strong> {row.oldValue || "—"}</div>
                      )}
                      {row.newValue !== null && row.newValue !== undefined && (
                        <div><strong>New:</strong> {row.newValue || "—"}</div>
                      )}
                      {row.reason && <div><strong>Reason:</strong> {row.reason}</div>}
                      <div><strong>Entity ID:</strong> {row.entityId}</div>
                      {row.stationId && <div><strong>Station:</strong> {row.stationId}</div>}
                      {row.ipAddress && <div><strong>IP:</strong> {row.ipAddress}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {data.totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 12, fontSize: 11 }}>
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span style={{ alignSelf: "center", color: "var(--text-dim)" }}>Page {data.page} of {data.totalPages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
