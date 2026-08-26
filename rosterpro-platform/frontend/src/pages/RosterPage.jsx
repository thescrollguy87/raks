import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import * as rosterApi from "../api/roster.js";
import ShiftEditModal from "../components/roster/ShiftEditModal.jsx";
import GenerationResultPanel from "../components/roster/GenerationResultPanel.jsx";

const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const CAT_LABELS = { B1: "B1 AME", B2: "B2 AME", CM: "Certifying Mechanic", NCS: "NCS / Tech", STO: "Stores" };

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function RosterPage() {
  const { hasPermission } = useAuth();
  const { stationId } = useStation();
  const [searchParams] = useSearchParams();
  const [monthKey, setMonthKey] = useState(() => searchParams.get("month") || new Date().toISOString().slice(0, 7));
  const [catFilter, setCatFilter] = useState("ALL");
  const [shiftDefs, setShiftDefs] = useState([]);
  const [roster, setRoster] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingCell, setEditingCell] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState(null);

  const canEdit = hasPermission("shift", "update");
  const canPublish = hasPermission("roster", "publish");
  const canUnpublish = hasPermission("roster", "unpublish");
  const canGenerate = hasPermission("roster", "update");

  const load = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    setError("");
    try {
      const [defs, grid] = await Promise.all([
        shiftDefs.length ? Promise.resolve(shiftDefs) : rosterApi.getShiftDefinitions(),
        rosterApi.getRosterGrid(stationId, monthKey),
      ]);
      setShiftDefs(defs);
      setRoster(grid.roster);
      setStaff(grid.staff);
    } catch (err) {
      setError(err.message || "Failed to load roster");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey, stationId]);

  useEffect(() => { load(); }, [load]);

  async function handleGenerate() {
    if (!confirm(`Generate the ${monthKey} roster? This assigns shifts for every active staff member — existing manual edits for this month will be overwritten.`)) return;
    setGenerating(true);
    setGenerationResult(null);
    try {
      const result = await rosterApi.generateRoster(stationId, monthKey);
      setGenerationResult(result);
      await load();
    } catch (err) {
      alert(`Generate failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  // actions is memoized because usePageHeader syncs it into context state on
  // every change — a fresh JSX element here on every render (this component
  // re-renders whenever the header context updates, since it subscribes to
  // it) would re-trigger that sync forever. Deps cover every reactive value
  // the block below, or the handlers it calls, close over.
  const headerActions = useMemo(() => (
    <>
      {canGenerate && roster && !roster.isPublished && (
        <button className="btn btn-ghost" disabled={generating} onClick={handleGenerate}>
          {generating ? "Generating…" : "🤖 Generate"}
        </button>
      )}
      {canPublish && roster && !roster.isPublished && (
        <button className="btn btn-primary" onClick={() => handlePublish()}>✅ Publish</button>
      )}
      {canUnpublish && roster?.isPublished && (
        <button className="btn btn-ghost" onClick={() => handleUnpublish()}>↩ Unpublish</button>
      )}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [canGenerate, canPublish, canUnpublish, roster, generating, monthKey, stationId]);

  usePageHeader({
    title: "Shift Roster",
    subtitle: `AMD · ${monthKey}${roster?.isPublished ? " · Published" : " · Draft"}`,
    actions: headerActions,
  });

  const shiftDefByCode = useMemo(() => Object.fromEntries(shiftDefs.map(d => [d.code, d])), [shiftDefs]);
  const nDays = daysInMonth(monthKey);

  async function handlePublish() {
    if (!confirm(`Publish the ${monthKey} roster? Staff will be notified by email.`)) return;
    try {
      await rosterApi.publishRoster(roster.id);
      await load();
    } catch (err) {
      alert(`Publish failed: ${err.message}`);
    }
  }

  async function handleUnpublish() {
    const reason = prompt("A reason is required to unpublish a live roster:");
    if (!reason) return;
    try {
      await rosterApi.unpublishRoster(roster.id, reason);
      await load();
    } catch (err) {
      alert(`Unpublish failed: ${err.message}`);
    }
  }

  function openCell(s, day) {
    if (!canEdit) return;
    const dateObj = dateAt(monthKey, day);
    const dateStr = dateObj.toISOString().slice(0, 10);
    const assignment = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
    setEditingCell({
      userId: s.id, staffName: s.fullName.split("(")[0].trim(),
      dateStr, dateLabel: `${dateStr} (Day ${day})`,
      currentCode: assignment?.shiftDef.code || "O",
    });
  }

  async function saveCell({ shiftCode, reason }) {
    await rosterApi.upsertShift(stationId, monthKey, {
      userId: editingCell.userId, shiftDate: editingCell.dateStr, shiftCode, reason,
    });
    await load();
  }

  const visibleStaff = catFilter === "ALL" ? staff : staff.filter(s => (s.category || "NCS") === catFilter);
  const byCategory = CATEGORIES.map(cat => ({ cat, staff: visibleStaff.filter(s => (s.category || "NCS") === cat) }))
    .filter(g => g.staff.length > 0);

  if (loading) return <div className="card">Loading roster…</div>;
  if (error) return <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>;

  return (
    <div>
      {generationResult && (
        <GenerationResultPanel result={generationResult} onDismiss={() => setGenerationResult(null)} />
      )}
      <div className="ab info" style={{ marginBottom: 9 }}>
        ℹ {monthKey} · {staff.length} staff · {nDays} days
        {canEdit ? " · Click any shift cell to edit" : " · View-only"}
      </div>

      <div style={{ display: "flex", gap: 7, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <button onClick={() => setMonthKey(m => shiftMonth(m, -1))} style={navBtnStyle}>‹</button>
          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 80, textAlign: "center" }}>{monthKey}</span>
          <button onClick={() => setMonthKey(m => shiftMonth(m, 1))} style={navBtnStyle}>›</button>
        </div>
        <select className="fi" style={{ width: 160, fontSize: 10 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="ALL">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
        </select>
      </div>

      <div className="roster-wrap">
        <table className="rt">
          <thead>
            <tr>
              <th className="sc">Staff</th>
              <th className="sc2">Cat</th>
              {Array.from({ length: nDays }, (_, i) => (
                <th key={i}><div style={{ fontSize: 8 }}>{i + 1}</div></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byCategory.map(group => (
              <RosterCategoryGroup
                key={group.cat} group={group} nDays={nDays} monthKey={monthKey}
                shiftDefByCode={shiftDefByCode} onCellClick={openCell}
              />
            ))}
            <CoverageRows staff={visibleStaff} nDays={nDays} monthKey={monthKey} />
          </tbody>
        </table>
      </div>

      {editingCell && (
        <ShiftEditModal cell={editingCell} shiftDefs={shiftDefs} onSave={saveCell} onClose={() => setEditingCell(null)} />
      )}
    </div>
  );
}

const navBtnStyle = { width: 24, height: 24, borderRadius: 5, background: "var(--glass)", border: "1px solid var(--border)", color: "var(--white)" };

function RosterCategoryGroup({ group, nDays, monthKey, shiftDefByCode, onCellClick }) {
  return (
    <>
      <tr>
        <td colSpan={nDays + 2} style={{ padding: "2px 7px", fontSize: 8, fontWeight: 700, color: "var(--text-dim)" }}>
          <span className={`cat-tag cat-${group.cat}`}>{group.cat}</span> {CAT_LABELS[group.cat]} · {group.staff.length} staff
        </td>
      </tr>
      {group.staff.map(s => (
        <tr key={s.id}>
          <td className="sc">
            <div className="sn">{s.fullName.split("(")[0].trim().substring(0, 20)}</div>
            <div className="sr">{s.designation}</div>
          </td>
          <td className="sc2"><span className={`cat-tag cat-${group.cat}`}>{group.cat}</span></td>
          {Array.from({ length: nDays }, (_, i) => {
            const day = i + 1;
            const dateStr = dateAt(monthKey, day).toISOString().slice(0, 10);
            const assignment = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
            const code = assignment?.shiftDef.code || "O";
            const def = shiftDefByCode[code];
            return (
              <td key={i}>
                <div
                  className="sp" onClick={() => onCellClick(s, day)}
                  title={def ? `${def.name}${def.startTime ? `: ${def.startTime}–${def.endTime}` : ""}` : code}
                  style={{ background: def?.bg || "rgba(180,180,180,.1)", color: def?.color || "#AABBCC" }}
                >
                  <span className="sc-code">{code}</span>
                </div>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

// Mirrors the prototype's coverage rows — per-day count of staff on each
// shift, so gaps are visible at a glance without opening the dashboard.
function CoverageRows({ staff, nDays, monthKey }) {
  const shifts = [
    { key: "M", label: "Morning" },
    { key: "A", label: "Afternoon" },
    { key: "N", label: "Night" },
  ];
  return (
    <>
      {shifts.map(sh => (
        <tr key={sh.key}>
          <td className="sc" style={{ fontSize: 8, fontWeight: 700, color: "var(--text-dim)" }}>{sh.label} Coverage</td>
          <td className="sc2"></td>
          {Array.from({ length: nDays }, (_, i) => {
            const dateStr = dateAt(monthKey, i + 1).toISOString().slice(0, 10);
            const count = staff.filter(s => s.shiftAssignments.some(sa =>
              new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr && sa.shiftDef.code === sh.key
            )).length;
            return (
              <td key={i}>
                <span className="cov-badge" style={{ opacity: count > 0 ? 1 : 0.3, color: count < 1 ? "var(--rp-red)" : "inherit" }}>
                  {count}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
