import { useEffect, useState } from "react";
import * as rosterApi from "../../api/roster.js";

// Roster History — view/compare/restore. Restore is deliberately NEVER a
// silent overwrite: the confirmation text and the backend behavior both
// make clear a restore creates a NEW version on top of history, it never
// rewrites or removes any existing version (see rosterVersionService on
// the backend — restoreVersion always appends, never mutates).
export default function RosterVersionsPanel({ stationId, monthKey, onClose, onRestored }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [compareSel, setCompareSel] = useState([]); // up to 2 version ids
  const [compareResult, setCompareResult] = useState(null);
  const [compareError, setCompareError] = useState("");

  function load() {
    setError("");
    rosterApi.listVersions(stationId, monthKey).then(setVersions).catch(err => setError(err.message));
  }

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, monthKey]);

  async function handleCreateVersion() {
    const reason = prompt("Optional: describe why you're creating this checkpoint (e.g. \"Before major reshuffle\"):", "Manual checkpoint");
    if (reason === null) return;
    setBusy(true);
    try {
      await rosterApi.createVersion(stationId, monthKey, reason || undefined);
      load();
    } catch (err) {
      alert(`Failed to create version: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(v) {
    const confirmed = confirm(
      `Restore Version ${v.versionNumber}? This will create a new current version based on Version ${v.versionNumber}. Existing history will be preserved.`
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await rosterApi.restoreVersion(v.id);
      await onRestored?.();
    } catch (err) {
      alert(`Restore failed: ${err.message}`);
      setBusy(false);
    }
  }

  function toggleCompare(id) {
    setCompareResult(null);
    setCompareError("");
    setCompareSel(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  async function handleCompare() {
    if (compareSel.length !== 2) return;
    setCompareError("");
    setCompareResult(null);
    try {
      // Compare in chronological order regardless of click order — "from"
      // is always the older of the two selected versions.
      const [a, b] = compareSel;
      const va = versions.find(v => v.id === a);
      const vb = versions.find(v => v.id === b);
      const [fromId, toId] = va.versionNumber <= vb.versionNumber ? [a, b] : [b, a];
      const result = await rosterApi.compareVersions(fromId, toId);
      setCompareResult(result);
    } catch (err) {
      setCompareError(err.message);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="popover-card" style={{ width: 620, maxHeight: "82vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="card-title" style={{ marginBottom: 4 }}>🕘 Roster History <span className="tag">{stationId ? monthKey : ""}</span></div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10 }}>
          Checkpoints of this roster — created automatically before publish and before an auto-generated roster overwrites existing shifts, or manually below. Restoring an older version never erases history: it creates a new version on top.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={handleCreateVersion}>+ Create Version</button>
          {compareSel.length === 2 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={handleCompare}>Compare Selected</button>
          )}
        </div>

        {error && <div className="ab red" style={{ marginBottom: 10 }}>{error}</div>}

        {!versions ? (
          <div className="empty-note">Loading…</div>
        ) : versions.length === 0 ? (
          <div className="empty-note">No versions yet — one is created automatically the first time this roster is published, regenerated over existing data, or imported.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {versions.map(v => (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }}>
                <input
                  type="checkbox" checked={compareSel.includes(v.id)} onChange={() => toggleCompare(v.id)}
                  title="Select to compare (pick two)"
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    Version {v.versionNumber}
                    {v.isPublishedSnapshot && <span className="tag" style={{ fontSize: 9 }}>Published snapshot</span>}
                    {v.restoredFromVersionId && <span className="tag" style={{ fontSize: 9 }}>↩ Restore</span>}
                  </div>
                  <div style={{ color: "var(--text-dim)" }}>
                    {v.reason || "—"} · {v.itemCount} shift{v.itemCount === 1 ? "" : "s"} · {v.createdByName || "System"} · {new Date(v.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleRestore(v)}>Restore</button>
              </div>
            ))}
          </div>
        )}

        {compareError && <div className="ab red" style={{ marginTop: 10 }}>{compareError}</div>}

        {compareResult && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <div className="card-title" style={{ marginBottom: 6 }}>
              Version {compareResult.fromVersion.versionNumber} → Version {compareResult.toVersion.versionNumber}
              <span className="tag">{compareResult.changedCells.length} cell{compareResult.changedCells.length === 1 ? "" : "s"} changed</span>
            </div>
            {compareResult.changedCells.length === 0 ? (
              <div className="empty-note">No differences between these two versions.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 220, overflowY: "auto" }}>
                {compareResult.changedCells.map((c, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "4px 6px", background: "rgba(15,23,42,.03)", borderRadius: 4 }}>
                    <span>{c.shiftDate}</span>
                    <span style={{ fontFamily: "var(--mono)" }}>{c.from?.shiftCode || "—"} → {c.to?.shiftCode || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
