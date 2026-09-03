import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useBillingReadOnly } from "../hooks/useBillingReadOnly.js";
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

// Net duty hours for one shift code — end minus start (wrapping past
// midnight for an overnight shift like Night) minus its break, same
// formula reference-ui's shiftNetHrs uses. Off/leave/unrecognized codes
// have no start/end and net 0.
function shiftNetHours(def) {
  if (!def?.startTime || !def?.endTime) return 0;
  const [sh, sm] = def.startTime.split(":").map(Number);
  const [eh, em] = def.endTime.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return Math.max(0, (mins - (def.breakMin || 0)) / 60);
}

// 7-day blocks across the real length of the month (4 for a 28-day
// February, 5 for a 29-31 day month) — same idea as reference-ui's WKB
// weekly hour columns, adapted to the actual day count instead of a
// hardcoded 31.
function weekBlocks(nDays) {
  const blocks = [];
  for (let start = 1; start <= nDays; start += 7) {
    blocks.push([start, Math.min(start + 6, nDays)]);
  }
  return blocks;
}

export default function RosterPage() {
  const { hasPermission } = useAuth();
  const { stationId, loading: stationLoading, currentStation } = useStation();
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
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef(null);

  const { isReadOnly } = useBillingReadOnly();
  // Folded into the SAME flags every write control already checks, rather
  // than adding a parallel set of `!isReadOnly &&` conditions at every call
  // site — the backend is still the real enforcement point (billingGate.js
  // rejects the write regardless), this just means every button already
  // gated by canEdit/canPublish/etc. is disabled for the same reason,
  // for free, with the existing "View-only" messaging below covering why.
  const canEdit = hasPermission("shift", "update") && !isReadOnly;
  const canPublish = hasPermission("roster", "publish") && !isReadOnly;
  const canUnpublish = hasPermission("roster", "unpublish") && !isReadOnly;
  const canGenerate = hasPermission("roster", "update") && !isReadOnly;

  const load = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    setError("");
    try {
      // Always refetched by stationId, never cached across renders — shift
      // definitions are airline-scoped (see api/roster.js), and a SUPER_ADMIN
      // switching the station switcher can land on a DIFFERENT airline
      // entirely, whose codes must never be shadowed by a previous tenant's.
      const [defs, grid] = await Promise.all([
        rosterApi.getShiftDefinitions(stationId),
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

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same filename later
    if (!file) return;
    if (!confirm(`Import "${file.name}" into ${monthKey}? This will overwrite existing shifts for every matched staff member in this month.`)) return;
    setImporting(true);
    try {
      const result = await rosterApi.importRoster(stationId, monthKey, file);
      let msg = `Imported: ${result.staffUpdated} staff updated, ${result.assignmentCount} shifts.`;
      if (result.notFound.length) msg += `\n\n${result.notFound.length} name(s) in the file don't match any staff at this station (add them via Staff Registry first): ${result.notFound.slice(0, 5).join(", ")}${result.notFound.length > 5 ? "…" : ""}`;
      if (result.invalidCodes.length) msg += `\n\nUnrecognized shift code(s), skipped: ${result.invalidCodes.join(", ")}`;
      if (result.duplicates.length) msg += `\n\n${result.duplicates.length} duplicate row(s) in the file — only the last occurrence of each was used.`;
      alert(msg);
      await load();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  // actions is memoized because usePageHeader syncs it into context state on
  // every change — a fresh JSX element here on every render (this component
  // re-renders whenever the header context updates, since it subscribes to
  // it) would re-trigger that sync forever. Deps cover every reactive value
  // the block below, or the handlers it calls, close over.
  const headerActions = useMemo(() => (
    <>
      {canEdit && roster && !roster.isPublished && (
        <>
          <input ref={importInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleImportFile} />
          <button className="btn btn-ghost" disabled={importing} onClick={() => importInputRef.current?.click()}>
            {importing ? "Importing…" : "⬆ Import Excel"}
          </button>
        </>
      )}
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
  ), [canEdit, canGenerate, canPublish, canUnpublish, roster, generating, importing, monthKey, stationId]);

  usePageHeader({
    title: "Shift Roster",
    subtitle: currentStation ? `${currentStation.iataCode} · ${monthKey}${roster?.isPublished ? " · Published" : " · Draft"}` : "",
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

  // Order matters here for the same reason as DashboardPage.jsx: check
  // stationLoading (still figuring out which station to use) before the
  // "no station" message, so a real stationId arriving doesn't briefly
  // read as "none" while this component's own load() hasn't re-run yet.
  if (stationLoading) return <div className="card">Loading roster…</div>;
  if (!stationId) return <div className="ab info">No station has been set up yet — ask an administrator to add one before a roster can be built.</div>;
  if (loading) return <div className="card">Loading roster…</div>;
  if (error) return <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>;

  return (
    <div>
      {generationResult && (
        <GenerationResultPanel result={generationResult} onDismiss={() => setGenerationResult(null)} />
      )}
      <div className="ab info" style={{ marginBottom: 9 }}>
        ℹ {monthKey} · {staff.length} staff · {nDays} days
        {canEdit ? " · Click any shift cell to edit" : isReadOnly ? " · Read-only (subscription required — see banner above)" : " · View-only"}
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
              {weekBlocks(nDays).map((wk, i) => <th key={i}>W{i + 1}</th>)}
              <th>Tot</th>
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
        <td colSpan={nDays + 2 + weekBlocks(nDays).length + 1} style={{ padding: "2px 7px", fontSize: 8, fontWeight: 700, color: "var(--text-dim)" }}>
          <span className={`cat-tag cat-${group.cat}`}>{group.cat}</span> {CAT_LABELS[group.cat]} · {group.staff.length} staff
        </td>
      </tr>
      {group.staff.map(s => {
        // Resolve each day's code once so the weekly-total pass below
        // doesn't re-derive it from shiftAssignments a second time.
        const codesByDay = Array.from({ length: nDays }, (_, i) => {
          const dateStr = dateAt(monthKey, i + 1).toISOString().slice(0, 10);
          const assignment = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
          return assignment?.shiftDef.code || "O";
        });
        const blocks = weekBlocks(nDays);
        const weekHours = blocks.map(([from, to]) => {
          let hrs = 0;
          for (let day = from; day <= to; day++) hrs += shiftNetHours(shiftDefByCode[codesByDay[day - 1]]);
          return hrs;
        });
        const totalHours = weekHours.reduce((a, b) => a + b, 0);

        return (
          <tr key={s.id}>
            <td className="sc">
              <div className="sn">{s.fullName.split("(")[0].trim().substring(0, 20)}</div>
              <div className="sr">{s.designation}</div>
            </td>
            <td className="sc2"><span className={`cat-tag cat-${group.cat}`}>{group.cat}</span></td>
            {codesByDay.map((code, i) => {
              const day = i + 1;
              const def = shiftDefByCode[code];
              return (
                <td key={i}>
                  <div
                    className="sp" onClick={() => onCellClick(s, day)}
                    title={def ? `${def.name}${def.startTime ? `: ${def.startTime}–${def.endTime}` : ""}` : code}
                    style={{ background: def?.bg || "rgba(180,180,180,.1)", color: def?.color || "#AABBCC" }}
                  >
                    <span className="sc-code">{code}</span>
                    {def?.startTime && <span className="sc-time">{def.startTime}–{def.endTime}</span>}
                  </div>
                </td>
              );
            })}
            {weekHours.map((hrs, i) => (
              <td key={i}>
                <span className={hrs > 48 ? "hrs-over" : hrs > 42 ? "hrs-warn" : "hrs-ok"}>{hrs.toFixed(1)}</span>
              </td>
            ))}
            <td><span className={totalHours > 200 ? "hrs-warn" : "hrs-ok"}>{totalHours.toFixed(1)}</span></td>
          </tr>
        );
      })}
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
          <td colSpan={weekBlocks(nDays).length + 1}></td>
        </tr>
      ))}
    </>
  );
}
