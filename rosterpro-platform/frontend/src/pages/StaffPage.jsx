import { useState, useEffect } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { listStaff } from "../api/staff.js";

export default function StaffPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  usePageHeader({ title: "Staff Registry", subtitle: "AMD Line Maintenance" });

  useEffect(() => {
    let cancelled = false;
    listStaff({ page: 1, pageSize: 100 })
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="card">Loading staff…</div>;
  if (error) return <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>;

  return (
    <div className="card">
      <div className="card-title">Staff Registry <span className="tag">{data.total} total</span></div>
      <table className="rt" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Name</th>
            <th>Category</th>
            <th style={{ textAlign: "left" }}>Designation</th>
            <th>Status</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map(s => (
            <tr key={s.id}>
              <td style={{ textAlign: "left", padding: "6px 4px" }}>{s.fullName}</td>
              <td><span className={`cat-tag cat-${s.category || "NCS"}`}>{s.category || "NCS"}</span></td>
              <td style={{ textAlign: "left" }}>{s.designation}</td>
              <td>
                <span className="tag" style={{ background: s.isActive ? "rgba(0,200,83,.12)" : "rgba(148,163,184,.15)", color: s.isActive ? "var(--rp-green)" : "var(--text-dim)" }}>
                  {s.isActive ? "Active" : "Inactive"}
                </span>
              </td>
              <td style={{ fontSize: 10, color: "var(--text-dim)" }}>{s.roles.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
