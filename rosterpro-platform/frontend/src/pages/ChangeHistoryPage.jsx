import { useState, useEffect } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import * as auditApi from "../api/audit.js";

export default function ChangeHistoryPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  usePageHeader({ title: "Change History", subtitle: "Recent activity across the platform" });

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
