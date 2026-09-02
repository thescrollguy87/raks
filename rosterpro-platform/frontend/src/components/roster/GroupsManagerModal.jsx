import { useState, useEffect, useCallback } from "react";
import * as ruleBuilderApi from "../../api/ruleBuilder.js";

// Optional feature: named staff groups (e.g. "Group A", "Group B") mixing
// any combination of B1/B2/CM/NCS/STO staff, for filtering the Shift
// Roster grid. Reuses the exact same StaffGroup data Auto-Roster
// Generator's Rule Builder tab already manages — a group made here shows
// up there too, and vice versa, since it's the same station-scoped table,
// not a parallel concept.
export default function GroupsManagerModal({ stationId, staff, onClose, onChanged }) {
  const [groups, setGroups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newGroupName, setNewGroupName] = useState("");

  const load = useCallback(() => {
    ruleBuilderApi.listStaffGroups(stationId).then(setGroups).catch(err => setError(err.message));
  }, [stationId]);
  useEffect(load, [load]);

  async function addGroup() {
    if (!newGroupName.trim()) return;
    setBusy(true); setError("");
    try {
      await ruleBuilderApi.upsertStaffGroup({ stationId, name: newGroupName.trim(), memberUserIds: [] });
      setNewGroupName("");
      load(); onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function renameGroup(group, name) {
    if (!name.trim() || name === group.name) return;
    setBusy(true); setError("");
    try {
      await ruleBuilderApi.upsertStaffGroup({ id: group.id, stationId, name: name.trim(), memberUserIds: group.members.map(m => m.userId) });
      load(); onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function toggleMember(group, userId) {
    const memberUserIds = group.members.some(m => m.userId === userId)
      ? group.members.filter(m => m.userId !== userId).map(m => m.userId)
      : [...group.members.map(m => m.userId), userId];
    setBusy(true); setError("");
    try {
      await ruleBuilderApi.upsertStaffGroup({ id: group.id, stationId, name: group.name, memberUserIds });
      load(); onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function removeGroup(id) {
    if (!confirm("Delete this group? Staff in it are unaffected — only the group itself goes away.")) return;
    setBusy(true); setError("");
    try {
      await ruleBuilderApi.deleteStaffGroup(id);
      load(); onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">👥 Manage Staff Groups</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 14 }}>
          Optional — mix any B1/B2/CM/NCS/STO staff into named groups (e.g. Group A, Group B) to filter this roster.
          Shared with Auto-Roster Generator's Rule Builder tab.
        </div>

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div className="fg2" style={{ marginBottom: 12 }}>
          <input className="fi" placeholder="New group name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
          <button className="btn btn-ghost btn-sm" onClick={addGroup} disabled={busy}>＋ Add Group</button>
        </div>

        {!groups ? <div>Loading…</div> : groups.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>No groups yet.</div>
        ) : (
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {groups.map(g => (
              <div key={g.id} style={{ marginBottom: 12, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <input
                    className="fi" style={{ fontSize: 11, fontWeight: 700 }} defaultValue={g.name}
                    onBlur={(e) => renameGroup(g, e.target.value)} disabled={busy}
                  />
                  <span style={{ fontSize: 9, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{g.members.length} staff</span>
                  <button className="wl-del" onClick={() => removeGroup(g.id)} disabled={busy}>✕</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 100, overflowY: "auto" }}>
                  {staff.map(s => (
                    <label key={s.id} style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3 }}>
                      <input type="checkbox" checked={g.members.some(m => m.userId === s.id)} onChange={() => toggleMember(g, s.id)} disabled={busy} />
                      {s.fullName.split("(")[0].trim()} <span style={{ color: "var(--text-dim)" }}>({s.category || "NCS"})</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
