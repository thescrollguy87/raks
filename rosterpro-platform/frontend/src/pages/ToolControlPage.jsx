import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as toolsApi from "../api/tools.js";


const STATUS_STYLE = {
  VALID: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  DUE: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  OVERDUE: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
  QUARANTINED: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
  IN_CALIBRATION: { background: "rgba(0,198,255,.1)", color: "var(--cyan)" },
};

export default function ToolControlPage() {
  const { hasPermission, user } = useAuth();
  const { stationId, currentStation } = useStation();
  const [tools, setTools] = useState(null);
  const [error, setError] = useState("");
  const canIssue = hasPermission("tool", "issue");
  const canReturn = hasPermission("tool", "return");

  usePageHeader({ title: "Tool Control", subtitle: currentStation ? `${currentStation.iataCode} · Calibration & issue tracking` : "" });

  const load = useCallback(() => {
    if (!stationId) return;
    toolsApi.listTools(stationId).then(setTools).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(() => { load(); }, [load]);

  async function handleIssue(tool) {
    try {
      await toolsApi.issueTool(tool.id, { issuedToId: user.id });
      load();
    } catch (err) { alert(`Issue failed: ${err.message}`); }
  }

  async function handleReturn(tool) {
    const openIssue = tool.issues?.find(i => !i.returnedAt);
    if (!openIssue) return;
    try {
      await toolsApi.returnTool(openIssue.id);
      load();
    } catch (err) { alert(`Return failed: ${err.message}`); }
  }

  if (error) return <div className="ab red">{error}</div>;
  if (!tools) return <div className="card">Loading tools…</div>;

  return (
    <div className="card">
      <div className="card-title">Tools <span className="tag">{tools.length}</span></div>
      <table className="rt" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Tool No.</th>
            <th style={{ textAlign: "left" }}>Description</th>
            <th>Calibration Due</th>
            <th>Status</th>
            <th>Issued To</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {tools.map(t => {
            const openIssue = t.issues?.find(i => !i.returnedAt);
            return (
              <tr key={t.id}>
                <td style={{ textAlign: "left", padding: "6px 4px" }}>{t.toolNo}</td>
                <td style={{ textAlign: "left" }}>{t.description}</td>
                <td>{t.calibrationDue ? new Date(t.calibrationDue).toISOString().slice(0, 10) : "—"}</td>
                <td><span className="tag" style={STATUS_STYLE[t.status]}>{t.status}</span></td>
                <td style={{ fontSize: 10, color: "var(--text-dim)" }}>{openIssue?.issuedTo?.fullName || "—"}</td>
                <td>
                  {!openIssue && canIssue && t.status === "VALID" && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleIssue(t)}>Issue to me</button>
                  )}
                  {openIssue && canReturn && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleReturn(t)}>Return</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
