import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as rosterApi from "../api/roster.js";

export default function PastRostersPage() {
  const { stationId } = useStation();
  const navigate = useNavigate();
  const [rosters, setRosters] = useState(null);
  const [error, setError] = useState("");

  usePageHeader({ title: "Past Rosters", subtitle: "AMD Line Maintenance · Archive" });

  useEffect(() => {
    if (!stationId) return;
    rosterApi.listArchive(stationId).then(setRosters).catch(err => setError(err.message));
  }, [stationId]);

  if (error) return <div className="ab red">{error}</div>;
  if (!rosters) return <div className="card">Loading archive…</div>;

  return (
    <div className="card">
      <div className="card-title">Roster Archive <span className="tag">{rosters.length} months</span></div>
      <table className="rt" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Month</th>
            <th>Status</th>
            <th>Shifts Assigned</th>
            <th>Published</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rosters.map(r => (
            <tr key={r.id}>
              <td style={{ textAlign: "left", padding: "6px 4px", fontWeight: 700 }}>{r.monthKey}</td>
              <td>
                <span className="tag" style={r.isPublished
                  ? { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" }
                  : { background: "rgba(148,163,184,.15)", color: "var(--text-dim)" }}>
                  {r.isPublished ? "Published" : "Draft"}
                </span>
              </td>
              <td>{r.shiftAssignmentCount}</td>
              <td style={{ fontSize: 10, color: "var(--text-dim)" }}>
                {r.publishedAt ? new Date(r.publishedAt).toISOString().slice(0, 10) : "—"}
              </td>
              <td>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/roster?month=${r.monthKey}`)}>View →</button>
              </td>
            </tr>
          ))}
          {rosters.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 12, fontSize: 11, color: "var(--text-dim)" }}>No rosters generated yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
