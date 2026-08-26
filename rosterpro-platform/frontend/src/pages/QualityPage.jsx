import { useState, useEffect, useCallback } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as qualityApi from "../api/quality.js";


const SEVERITY_STYLE = {
  critical: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
  major: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  minor: { background: "rgba(148,163,184,.15)", color: "var(--text-dim)" },
};
const STATUS_STYLE = {
  OPEN: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
  IN_PROGRESS: { background: "rgba(245,166,35,.15)", color: "var(--amber)" },
  CLOSED: { background: "rgba(0,200,83,.12)", color: "var(--rp-green)" },
  OVERDUE: { background: "rgba(229,57,53,.18)", color: "var(--rp-red)" },
};

export default function QualityPage() {
  const { hasPermission, user } = useAuth();
  const { stationId } = useStation();
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState("");
  const canCreate = hasPermission("audit_finding", "create");

  usePageHeader({
    title: "Quality — Audit Findings & CAPA",
    subtitle: "AMD Line Maintenance",
    actions: canCreate ? <button className="btn btn-primary" onClick={handleRaiseFinding}>＋ Raise Finding</button> : null,
  });

  const load = useCallback(() => {
    if (!stationId) return;
    qualityApi.listFindings(stationId).then(setFindings).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(() => { load(); }, [load]);

  async function handleRaiseFinding() {
    const category = prompt("Category (e.g. Documentation, Tooling, Human Factors):");
    if (!category) return;
    const severity = prompt("Severity (minor / major / critical):", "minor");
    if (!["minor", "major", "critical"].includes(severity)) { alert("Severity must be minor, major, or critical"); return; }
    const description = prompt("Description:");
    if (!description) return;
    try {
      await qualityApi.raiseFinding({ stationId, category, severity, description });
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  async function handleOpenCapa(finding) {
    const correctiveAction = prompt("Corrective action:");
    if (!correctiveAction) return;
    const targetDate = prompt("Target date (YYYY-MM-DD):");
    if (!targetDate) return;
    try {
      await qualityApi.openCapa({ findingId: finding.id, ownerId: user.id, correctiveAction, targetDate });
      load();
    } catch (err) {
      alert(`Failed: ${err.message}`);
    }
  }

  if (error) return <div className="ab red">{error}</div>;
  if (!findings) return <div className="card">Loading findings…</div>;

  return (
    <div className="card">
      <div className="card-title">Audit Findings <span className="tag">{findings.length}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {findings.map(f => (
          <div key={f.id} style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                <span className="tag" style={SEVERITY_STYLE[f.severity]}>{f.severity}</span>
                <span className="tag" style={STATUS_STYLE[f.status]}>{f.status}</span>
                <strong style={{ fontSize: 11 }}>{f.category}</strong>
              </div>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Raised by {f.raisedBy?.fullName}</span>
            </div>
            <div style={{ fontSize: 11, marginBottom: 4 }}>{f.description}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                {f.capas?.length || 0} CAPA(s) {f.dueDate && `· Due ${new Date(f.dueDate).toISOString().slice(0, 10)}`}
              </span>
              {f.status !== "CLOSED" && hasPermission("capa", "create") && (
                <button className="btn btn-ghost btn-sm" onClick={() => handleOpenCapa(f)}>＋ Open CAPA</button>
              )}
            </div>
          </div>
        ))}
        {findings.length === 0 && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No audit findings recorded.</div>}
      </div>
    </div>
  );
}
