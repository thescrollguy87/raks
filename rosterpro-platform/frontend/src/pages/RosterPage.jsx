import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useBillingReadOnly } from "../hooks/useBillingReadOnly.js";
import { usePendingSaveQueue } from "../hooks/usePendingSaveQueue.js";
import * as rosterApi from "../api/roster.js";
import * as workloadConfigApi from "../api/workloadConfig.js";
import * as flightScheduleApi from "../api/flightSchedule.js";
import { getDashboardSummary } from "../api/dashboard.js";
import { downloadReport } from "../api/reports.js";
import ShiftEditModal from "../components/roster/ShiftEditModal.jsx";
import StaffDetailDrawer from "../components/roster/StaffDetailDrawer.jsx";
import GenerationResultPanel from "../components/roster/GenerationResultPanel.jsx";
import RosterVersionsPanel from "../components/roster/RosterVersionsPanel.jsx";
import RosterImportWizard from "../components/roster/RosterImportWizard.jsx";
import { shiftNetHours, shiftBucket } from "../utils/shiftHours.js";

const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const CAT_LABELS = { B1: "B1 AME", B2: "B2 AME", CM: "Certifying Mechanic", NCS: "NCS / Tech", STO: "Stores" };
const SHIFT_KEYS = [{ key: "M", label: "Morning" }, { key: "A", label: "Afternoon" }, { key: "N", label: "Night" }];

// A roster this size (staff count, not day count — see the plan's scope
// note on column virtualization) is where rendering every row up front
// starts to cost real frame time; below it, virtualizing would only add
// overhead (spacer-row bookkeeping) for no benefit, so small/typical
// rosters render exactly as they always have.
const VIRTUALIZE_STAFF_THRESHOLD = 50;

function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dateAt(monthKey, day) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function isWeekend(monthKey, day) {
  const dow = dateAt(monthKey, day).getUTCDay();
  return dow === 0 || dow === 6;
}
function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
const WEEKDAY_LETTERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

// Dev-only render instrumentation — logs every time a row/cell component
// actually renders, so "did my one-cell edit re-render the whole grid" is
// directly checkable in the console instead of just assumed. Free in
// production (import.meta.env.DEV is statically replaced by Vite, so the
// whole branch is dead-code-eliminated from the prod bundle).
function useRenderCount(label) {
  const countRef = useRef(0);
  if (import.meta.env.DEV) {
    countRef.current += 1;
    // eslint-disable-next-line no-console
    console.debug(`[render] ${label} #${countRef.current}`);
  }
}

export default function RosterPage() {
  const { hasPermission } = useAuth();
  const { stationId, loading: stationLoading, currentStation } = useStation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [monthKey, setMonthKey] = useState(() => searchParams.get("month") || new Date().toISOString().slice(0, 7));
  const [catFilter, setCatFilter] = useState(() => searchParams.get("category") || "ALL");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("month");
  const [shiftDefs, setShiftDefs] = useState([]);
  const [roster, setRoster] = useState(null);
  const [staff, setStaff] = useState([]);
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [mandatoryRules, setMandatoryRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingCell, setEditingCell] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [kpiDetail, setKpiDetail] = useState(null); // null | { type: "shift", bucket, label } | { type: "conflicts" }
  const [generating, setGenerating] = useState(false);
  const [generationResult, setGenerationResult] = useState(null);
  const [exportingFormat, setExportingFormat] = useState(null); // null | "excel" | "pdf"
  const [showVersions, setShowVersions] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);

  // Excel-style grid selection/clipboard — a Set of "userId|day" keys for
  // whichever cells are currently selected, the anchor cell a shift-click
  // range is measured from, and an in-memory clipboard (this app's grid
  // isn't text, so the OS clipboard doesn't apply — Ctrl+C/X/V just move
  // values between cells the same way Excel does within one sheet).
  const [selectedCells, setSelectedCells] = useState(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState(null); // { userId, day } | null
  const [clipboard, setClipboard] = useState(null); // { cells: [{rowOffset,colOffset,shiftCode,in1,out1,in2,out2}], isCut, sourceKeys } | null

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
  const canExport = hasPermission("reports", "export");

  const saveQueue = usePendingSaveQueue();

  const load = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    setError("");
    try {
      // Always refetched by stationId, never cached across renders — shift
      // definitions are airline-scoped (see api/roster.js), and a SUPER_ADMIN
      // switching the station switcher can land on a DIFFERENT airline
      // entirely, whose codes must never be shadowed by a previous tenant's.
      // Dashboard summary + mandatory coverage rules feed the new KPI row,
      // Daily Coverage table, and Roster Validation card below with real
      // numbers already computed elsewhere in the app — never fabricated.
      // Flight coverage must reflect the roster month actually being
      // viewed, not always "the real current calendar month" (the
      // summary endpoint's own default) — otherwise flipping to a past or
      // future month here would keep showing this month's flight count.
      const [y, m] = monthKey.split("-").map(Number);
      const monthFrom = new Date(Date.UTC(y, m - 1, 1)).toISOString();
      const monthTo = new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString();

      const [defs, grid, summary, rules] = await Promise.all([
        rosterApi.getShiftDefinitions(stationId),
        rosterApi.getRosterGrid(stationId, monthKey),
        getDashboardSummary(stationId, { monthKey, from: monthFrom, to: monthTo }).catch(() => null),
        workloadConfigApi.listMandatoryCoverageRules(stationId).catch(() => []),
      ]);
      setShiftDefs(defs);
      setRoster(grid.roster);
      setStaff(grid.staff);
      setDashboardSummary(summary);
      setMandatoryRules(rules || []);
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

  async function handleExport(format) {
    setExportingFormat(format);
    try {
      await downloadReport("roster", format, { stationId, monthKey });
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExportingFormat(null);
    }
  }

  // actions is memoized because usePageHeader syncs it into context state on
  // every change — a fresh JSX element here on every render (this component
  // re-renders whenever the header context updates, since it subscribes to
  // it) would re-trigger that sync forever. Deps cover every reactive value
  // the block below, or the handlers it calls, close over.
  const headerActions = useMemo(() => (
    <>
      <button className="btn btn-ghost" disabled={loading} onClick={load} title="Reload roster data">↻ Refresh</button>
      {roster && (
        <button className="btn btn-ghost" onClick={() => setShowVersions(true)} title="View, compare, and restore previous versions of this roster">🕘 History</button>
      )}
      {canExport && (
        <>
          <button className="btn btn-ghost" disabled={!!exportingFormat} onClick={() => handleExport("excel")}>
            {exportingFormat === "excel" ? "Exporting…" : "⬇ Excel"}
          </button>
          <button className="btn btn-ghost" disabled={!!exportingFormat} onClick={() => handleExport("pdf")}>
            {exportingFormat === "pdf" ? "Exporting…" : "⬇ PDF"}
          </button>
        </>
      )}
      {canEdit && roster && !roster.isPublished && (
        <button className="btn btn-ghost" onClick={() => setShowImportWizard(true)}>⬆ Import</button>
      )}
      {canGenerate && roster && !roster.isPublished && (
        <button className="btn btn-ghost" disabled={generating} onClick={handleGenerate}>
          {generating ? "Generating…" : "🤖 Auto Generate"}
        </button>
      )}
      {canPublish && roster && !roster.isPublished && (
        <button className="btn btn-primary" onClick={() => handlePublish()}>✅ Publish Roster</button>
      )}
      {canUnpublish && roster?.isPublished && (
        <button className="btn btn-ghost" onClick={() => handleUnpublish()}>↩ Unpublish</button>
      )}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [canEdit, canExport, canGenerate, canPublish, canUnpublish, roster, generating, exportingFormat, loading, monthKey, stationId]);

  usePageHeader({
    title: "Shift Roster",
    subtitle: "Plan today for a smoother tomorrow",
    actions: headerActions,
  });

  const shiftDefByCode = useMemo(() => Object.fromEntries(shiftDefs.map(d => [d.code, d])), [shiftDefs]);
  const nDays = daysInMonth(monthKey);
  const todayStr = todayISO();
  const isCurrentMonth = monthKey === todayStr.slice(0, 7);
  const todayDayNum = isCurrentMonth ? Number(todayStr.slice(8, 10)) : null;

  async function handlePublish() {
    if (!confirm(`Publish the ${monthKey} roster? Staff will be notified by email. A version checkpoint of the current roster is created automatically.`)) return;
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

  // O(1) lookup by id — every cell/click handler below resolves the staff
  // object it needs (fullName, shiftAssignments, ...) through this instead
  // of `staff.find(...)`, and passes only the userId down through
  // render props, so a row/cell's own props stay primitive and shallow-
  // comparable (see RosterRow/RosterCell below).
  const staffById = useMemo(() => new Map(staff.map(s => [s.id, s])), [staff]);
  // Same "read through a ref so a stable callback doesn't have to change
  // identity every edit" trick as flatStaffOrderRef below — staffById is a
  // brand-new Map every time `staff`'s top-level array reference changes
  // (i.e. on every single edit), so openCell/setSelectedStaffId read the
  // CURRENT map via this ref rather than depending on staffById directly.
  const staffByIdRef = useRef(staffById);
  useEffect(() => { staffByIdRef.current = staffById; }, [staffById]);

  // Builds the client-side shape of a ShiftAssignment row (same fields the
  // API returns, incl. the nested shiftDef the grid renders from) so an
  // edit can be reflected on screen the instant it's made, without waiting
  // for the round-trip this used to `await load()` for.
  const buildOptimisticAssignment = useCallback((dateStr, shiftCode, in1, out1, in2, out2, note) => {
    const def = shiftDefByCode[shiftCode];
    return {
      shiftDate: `${dateStr}T00:00:00.000Z`,
      shiftDefId: def?.id || null,
      shiftDef: def
        ? { code: def.code, name: def.name, color: def.color, type: def.type, startTime: def.startTime, endTime: def.endTime, breakMin: def.breakMin }
        : { code: shiftCode, name: shiftCode, color: "#B4B4B4", type: "other", startTime: null, endTime: null, breakMin: 0 },
      note: note || null, in1: in1 || null, out1: out1 || null, in2: in2 || null, out2: out2 || null,
    };
  }, [shiftDefByCode]);

  // The one place `staff` is ever mutated after the initial load. Replaces
  // ONLY the touched staff member's own object (and therefore only their
  // `shiftAssignments` array) — every other staff object in the array
  // keeps the exact same reference it had before, which is what actually
  // lets RosterRow's memoization work: React.memo's shallow prop compare
  // sees unchanged references for every row but this one, so only that
  // one row's cells re-render, not the other ~200.
  const applyAssignmentToStaff = useCallback((userId, dateStr, assignment) => {
    setStaff(prev => prev.map(s => {
      if (s.id !== userId) return s;
      const kept = s.shiftAssignments.filter(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) !== dateStr);
      return { ...s, shiftAssignments: assignment ? [...kept, assignment] : kept };
    }));
  }, []);

  // useCallback'd (not a plain function) so its reference stays stable
  // across RosterPage re-renders that have nothing to do with the grid
  // (the save-status pill flipping, a KPI modal opening, ...) — passed
  // straight down to every RosterRow as onCellDoubleClick, a plain
  // function here would get a new identity every render and silently
  // defeat RosterRow's React.memo on every one of those unrelated renders.
  const openCell = useCallback((userId, day) => {
    if (!canEdit) return;
    const s = staffByIdRef.current.get(userId);
    if (!s) return;
    const dateObj = dateAt(monthKey, day);
    const dateStr = dateObj.toISOString().slice(0, 10);
    const assignment = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
    setEditingCell({
      userId: s.id, staffName: s.fullName.split("(")[0].trim(),
      dateStr, dateLabel: `${dateStr} (Day ${day})`,
      currentCode: assignment?.shiftDef.code || "O",
      currentIn1: assignment?.in1 || null, currentOut1: assignment?.out1 || null,
      currentIn2: assignment?.in2 || null, currentOut2: assignment?.out2 || null,
    });
  }, [canEdit, monthKey]);

  // Same stability requirement as openCell above — passed down as
  // onStaffClick to every row.
  const setSelectedStaffId = useCallback((userId) => {
    const s = staffByIdRef.current.get(userId);
    if (s) setSelectedStaff(s);
  }, []);

  // Optimistic + queued, NOT awaited by the modal beyond this function
  // returning — the modal closes immediately (see ShiftEditModal's
  // handleSave, which awaits this promise and then calls onClose), and the
  // actual PATCH request runs in the background through the save queue,
  // with its own retry/status surfaced by the shared pill rather than a
  // per-modal error. The single-cell endpoint is kept (not folded into the
  // bulk one) specifically so this still gets its own audit-trail entry
  // with `reason`, exactly as before.
  async function saveCell({ shiftCode, reason, in1, out1, in2, out2 }) {
    const { userId, dateStr } = editingCell;
    applyAssignmentToStaff(userId, dateStr, buildOptimisticAssignment(dateStr, shiftCode, in1, out1, in2, out2));
    saveQueue.enqueue(`single:${userId}:${dateStr}`, () =>
      rosterApi.upsertShift(stationId, monthKey, { userId, shiftDate: dateStr, shiftCode, reason, in1, out1, in2, out2 })
    );
  }

  const cellKey = useCallback((userId, day) => `${userId}|${day}`, []);

  // Same row order the grid actually renders (grouped by category, same as
  // byCategory below) — selection/copy/paste measure "row N" against THIS,
  // not the unsorted staff list, so a shift-click range and a paste anchor
  // land on the row the user is actually looking at.
  const q = search.trim().toLowerCase();
  const visibleStaff = useMemo(() => staff
    .filter(s => catFilter === "ALL" || (s.category || "NCS") === catFilter)
    .filter(s => !q || s.fullName.toLowerCase().includes(q) || (s.designation || "").toLowerCase().includes(q)),
  [staff, catFilter, q]);

  const byCategory = useMemo(() => CATEGORIES
    .map(cat => ({ cat, staff: visibleStaff.filter(s => (s.category || "NCS") === cat) }))
    .filter(g => g.staff.length > 0),
  [visibleStaff]);

  const flatStaffOrder = useMemo(() => byCategory.flatMap(g => g.staff), [byCategory]);

  const dayRange = useMemo(() => {
    if (viewMode === "day") return [todayDayNum || 1];
    if (viewMode === "week") {
      const base = todayDayNum || 1;
      const dow = dateAt(monthKey, base).getUTCDay();
      const mondayOffset = (dow + 6) % 7;
      const start = Math.max(1, base - mondayOffset);
      const days = [];
      for (let d = start; d <= Math.min(start + 6, nDays); d++) days.push(d);
      return days;
    }
    return Array.from({ length: nDays }, (_, i) => i + 1);
  }, [viewMode, nDays, todayDayNum, monthKey]);

  // Single click selects (Excel-style) — a separate, explicit double-click
  // opens the full edit modal (openCell) for setting times/notes. Shift+click
  // extends the current selection into a rectangle between the anchor and
  // the clicked cell, measured in row/column position so it's the visible
  // rectangle the user is looking at, same as an Excel range-select.
  // flatStaffOrder gets a brand-new array reference on every edit (it's
  // derived from `staff`, which `applyAssignmentToStaff` always replaces
  // with a new top-level array even though individual staff objects keep
  // their references — see that function's own comment). Reading it
  // through a ref, instead of closing over it directly, keeps
  // handleCellSelect's own identity from changing on every edit — if it
  // were a dep here, every RosterRow's onCellClick prop would change
  // reference on every save, defeating React.memo for the whole grid even
  // though only one row's data actually changed.
  const flatStaffOrderRef = useRef(flatStaffOrder);
  useEffect(() => { flatStaffOrderRef.current = flatStaffOrder; }, [flatStaffOrder]);

  const handleCellSelect = useCallback((userId, day, e) => {
    if (!canEdit) return;
    if (e.shiftKey && selectionAnchor) {
      const rows = flatStaffOrderRef.current.map(st => st.id);
      const r1 = rows.indexOf(selectionAnchor.userId), r2 = rows.indexOf(userId);
      const c1 = dayRange.indexOf(selectionAnchor.day), c2 = dayRange.indexOf(day);
      if (r1 === -1 || r2 === -1 || c1 === -1 || c2 === -1) return;
      const [rLo, rHi] = [Math.min(r1, r2), Math.max(r1, r2)];
      const [cLo, cHi] = [Math.min(c1, c2), Math.max(c1, c2)];
      const next = new Set();
      for (let r = rLo; r <= rHi; r++) {
        for (let c = cLo; c <= cHi; c++) next.add(cellKey(rows[r], dayRange[c]));
      }
      setSelectedCells(next);
    } else {
      setSelectionAnchor({ userId, day });
      setSelectedCells(new Set([cellKey(userId, day)]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, selectionAnchor, dayRange, cellKey]);

  function assignmentFor(s, day) {
    const dateStr = dateAt(monthKey, day).toISOString().slice(0, 10);
    return s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
  }

  // Optimistic + queued as ONE bulk job (same as today's single bulk
  // network call) — every affected cell is applied to local state
  // immediately, then one `bulkUpsertShifts` request is enqueued to persist
  // all of them together. Not awaited by callers beyond this returning;
  // failures surface via the shared save-status pill, not a blocking alert.
  function writeCells(assignments) {
    if (!assignments.length) return;
    for (const a of assignments) {
      applyAssignmentToStaff(a.userId, a.shiftDate, a.shiftCode === "O" ? null : buildOptimisticAssignment(a.shiftDate, a.shiftCode, a.in1, a.out1, a.in2, a.out2));
    }
    const jobId = `bulk:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    saveQueue.enqueue(jobId, () => rosterApi.bulkUpsertShifts(stationId, monthKey, assignments));
  }

  // Delete/Backspace — clears every selected cell back to "O", the same
  // "no assignment" state a brand-new cell starts in.
  function handleClearSelected() {
    if (!canEdit || !selectedCells.size) return;
    if (roster?.isPublished) { alert("Roster is published — unpublish before editing."); return; }
    const assignments = [...selectedCells].map(key => {
      const [userId, dayStr] = key.split("|");
      return { userId, shiftDate: dateAt(monthKey, Number(dayStr)).toISOString().slice(0, 10), shiftCode: "O" };
    });
    writeCells(assignments);
  }

  // Ctrl+C/Ctrl+X — snapshots each selected cell's current code + any time
  // overrides, stored relative to the selection's own top-left corner so a
  // paste elsewhere can reproduce the same shape starting at a new anchor.
  function handleCopy(isCut) {
    if (!selectedCells.size) return;
    const rows = flatStaffOrder.map(st => st.id);
    const cells = [...selectedCells].map(key => {
      const [userId, dayStr] = key.split("|");
      const day = Number(dayStr);
      const s = staffById.get(userId);
      const a = s && assignmentFor(s, day);
      return {
        rowIndex: rows.indexOf(userId), colIndex: dayRange.indexOf(day),
        shiftCode: a?.shiftDef.code || "O",
        in1: a?.in1 || null, out1: a?.out1 || null, in2: a?.in2 || null, out2: a?.out2 || null,
      };
    });
    const minRow = Math.min(...cells.map(c => c.rowIndex));
    const minCol = Math.min(...cells.map(c => c.colIndex));
    setClipboard({
      cells: cells.map(c => ({ rowOffset: c.rowIndex - minRow, colOffset: c.colIndex - minCol, shiftCode: c.shiftCode, in1: c.in1, out1: c.out1, in2: c.in2, out2: c.out2 })),
      isCut, sourceKeys: isCut ? [...selectedCells] : null,
    });
  }

  // Ctrl+V — pastes anchored at the current selection's top-left corner.
  // Copying one cell and pasting into a multi-cell selection fills every
  // selected cell with that value (Excel's "copy one, paste into a range"
  // behavior); otherwise the copied shape is replicated starting at the
  // anchor, clipped to the grid's actual rows/columns. A pending cut only
  // clears its source cells once the paste has actually landed (applied
  // locally — not waiting on the network, same optimistic model as
  // everything else here).
  function handlePaste() {
    if (!clipboard || !selectedCells.size || !canEdit) return;
    if (roster?.isPublished) { alert("Roster is published — unpublish before editing."); return; }
    const rows = flatStaffOrder.map(st => st.id);
    const selCells = [...selectedCells].map(key => {
      const [userId, dayStr] = key.split("|");
      const day = Number(dayStr);
      return { userId, day, rowIndex: rows.indexOf(userId), colIndex: dayRange.indexOf(day) };
    });
    const anchorRow = Math.min(...selCells.map(c => c.rowIndex));
    const anchorCol = Math.min(...selCells.map(c => c.colIndex));

    let targets;
    if (clipboard.cells.length === 1 && selCells.length > 1) {
      targets = selCells.map(sc => ({ userId: sc.userId, day: sc.day, ...clipboard.cells[0] }));
    } else {
      targets = [];
      for (const rc of clipboard.cells) {
        const rowIndex = anchorRow + rc.rowOffset;
        const colIndex = anchorCol + rc.colOffset;
        if (rowIndex < 0 || rowIndex >= rows.length || colIndex < 0 || colIndex >= dayRange.length) continue;
        targets.push({ userId: rows[rowIndex], day: dayRange[colIndex], ...rc });
      }
    }
    if (!targets.length) return;

    const assignments = targets.map(t => ({
      userId: t.userId, shiftDate: dateAt(monthKey, t.day).toISOString().slice(0, 10),
      shiftCode: t.shiftCode, in1: t.in1, out1: t.out1, in2: t.in2, out2: t.out2,
    }));

    writeCells(assignments);
    if (clipboard.isCut && clipboard.sourceKeys) {
      const targetKeys = new Set(targets.map(t => cellKey(t.userId, t.day)));
      const toClear = clipboard.sourceKeys.filter(k => !targetKeys.has(k));
      if (toClear.length) {
        writeCells(toClear.map(key => {
          const [userId, dayStr] = key.split("|");
          return { userId, shiftDate: dateAt(monthKey, Number(dayStr)).toISOString().slice(0, 10), shiftCode: "O" };
        }));
      }
      setClipboard(null);
    }
  }

  // Keyboard shortcuts only act while a cell is selected and focus isn't
  // inside a text input elsewhere on the page (the search box, a modal's
  // own fields) — otherwise Ctrl+C/X/V and Delete keep their normal
  // browser/OS meaning everywhere else in the app.
  useEffect(() => {
    function onKeyDown(e) {
      if (editingCell || !selectedCells.size) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleClearSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleCopy(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        e.preventDefault();
        handleCopy(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        handlePaste();
      } else if (e.key === "Escape") {
        setClipboard(null);
        setSelectedCells(new Set());
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  // Legend: only the shift codes actually assigned somewhere this month, in
  // their configured display order — not a hardcoded M/A/N/L/O/FS list,
  // since this app's real seed data has two dozen+ codes (M1, MS, A1, A2,
  // AS, N1-N3, BS, FS, SOD, TRG, ...) and a fixed 6-item legend would
  // mislabel most of what's actually on the grid.
  const legendDefs = useMemo(() => {
    const inUse = new Set();
    staff.forEach(s => s.shiftAssignments.forEach(sa => inUse.add(sa.shiftDef.code)));
    return shiftDefs.filter(d => inUse.has(d.code)).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }, [staff, shiftDefs]);

  // KPI row + Daily Coverage's real "Required" numbers, computed once and
  // shared between both — Required comes from the Mandatory Coverage rules
  // already configured in Workload Config (Rule Builder's own minimum-
  // staffing source), never an invented target.
  const kpi = useMemo(() => {
    const requiredByShift = { M: 0, A: 0, N: 0 };
    mandatoryRules.filter(r => r.enabled).forEach(r => {
      if (requiredByShift[r.shift] != null) requiredByShift[r.shift] += r.minCount;
    });
    const assignedToday = { M: 0, A: 0, N: 0 };
    if (isCurrentMonth) {
      for (const s of staff) {
        const a = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === todayStr);
        const bucket = a && shiftBucket(a.shiftDef.code, shiftDefByCode[a.shiftDef.code]);
        if (bucket) assignedToday[bucket]++;
      }
    }
    const totalReq = requiredByShift.M + requiredByShift.A + requiredByShift.N;
    let coveragePct = 100;
    if (totalReq > 0) {
      const covered = Math.min(assignedToday.M, requiredByShift.M) + Math.min(assignedToday.A, requiredByShift.A) + Math.min(assignedToday.N, requiredByShift.N);
      coveragePct = Math.round((covered / totalReq) * 100);
    }
    return {
      totalStaff: staff.length,
      flights: dashboardSummary?.flightCoverage?.totalFlights ?? 0,
      onTimeRate: dashboardSummary?.flightCoverage?.onTimeRate,
      conflicts: dashboardSummary?.rosterCoverage?.violationCount ?? 0,
      requiredByShift, assignedToday, coveragePct,
    };
  }, [staff, mandatoryRules, dashboardSummary, shiftDefByCode, isCurrentMonth, todayStr]);

  const violations = dashboardSummary?.rosterCoverage?.violations || [];

  // Who's actually on duty today for a given shift bucket (M/A/N) — same
  // computation the KPI counts and the in-grid Coverage rows already use,
  // just returning the staff themselves instead of a count, for the
  // "click a KPI to see who" detail popover.
  function staffOnDutyToday(bucket) {
    if (!isCurrentMonth) return [];
    return staff
      .map(s => {
        const a = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === todayStr);
        if (!a) return null;
        const def = shiftDefByCode[a.shiftDef.code];
        if (shiftBucket(a.shiftDef.code, def) !== bucket) return null;
        const in1 = a.in1 || def?.startTime;
        const out1 = a.out1 || def?.endTime;
        return { id: s.id, fullName: s.fullName.split("(")[0].trim(), category: s.category || "NCS", code: a.shiftDef.code, time: in1 ? `${in1}–${out1}` : null };
      })
      .filter(Boolean);
  }

  // Row virtualization (staff count only — see VIRTUALIZE_STAFF_THRESHOLD)
  // renders a flat list of "either a category header or a staff row" so one
  // virtualizer can window across category groups. Below the threshold this
  // is entirely unused — `.roster-wrap` keeps its original (no-overflow,
  // page-scrolls) layout and every row renders directly, unchanged from
  // before this pass.
  const shouldVirtualize = flatStaffOrder.length > VIRTUALIZE_STAFF_THRESHOLD;
  const renderItems = useMemo(() => {
    const items = [];
    for (const group of byCategory) {
      items.push({ type: "header", key: `h-${group.cat}`, cat: group.cat, count: group.staff.length });
      for (const s of group.staff) items.push({ type: "row", key: s.id, staffId: s.id, cat: group.cat });
    }
    return items;
  }, [byCategory]);

  const scrollElRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: (i) => (renderItems[i]?.type === "header" ? 26 : 36),
    overscan: 10,
    enabled: shouldVirtualize,
  });

  const totalCols = 2 + dayRange.length + (viewMode === "month" ? weekBlocks(nDays).length + 1 : 0);

  // Order matters here for the same reason as DashboardPage.jsx: check
  // stationLoading (still figuring out which station to use) before the
  // "no station" message, so a real stationId arriving doesn't briefly
  // read as "none" while this component's own load() hasn't re-run yet.
  if (stationLoading) return <div className="card">Loading roster…</div>;
  if (!stationId) return <div className="ab info">No station has been set up yet — ask an administrator to add one before a roster can be built.</div>;
  if (loading) return <div className="card">Loading roster…</div>;
  if (error) return <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>;

  const virtualRows = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;

  return (
    <div>
      {generationResult && (
        <GenerationResultPanel result={generationResult} onDismiss={() => setGenerationResult(null)} />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <StatusPill roster={roster} />
        <SaveStatusPill status={saveQueue.status} pendingCount={saveQueue.pendingCount} onRetry={saveQueue.retry} />
      </div>

      {/* Toolbar: month / station-scoped category / search / view density */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <button onClick={() => setMonthKey(m => shiftMonth(m, -1))} style={navBtnStyle}>‹</button>
          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 88, textAlign: "center" }}>{monthLabel(monthKey)}</span>
          <button onClick={() => setMonthKey(m => shiftMonth(m, 1))} style={navBtnStyle}>›</button>
        </div>
        <select className="fi" style={{ width: 170, fontSize: 11 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="ALL">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
        </select>
        <input
          className="fi" style={{ width: 200, fontSize: 11 }} type="text" placeholder="🔍 Search staff…"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <div className="view-toggle">
          {["Month", "Week", "Day"].map(m => (
            <button key={m} className={`view-toggle-btn${viewMode === m.toLowerCase() ? " active" : ""}`} onClick={() => setViewMode(m.toLowerCase())}>{m}</button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard tone="sky" icon="👥" label="Total Staff" value={kpi.totalStaff} />
        <StatCard tone="sky" icon="✈️" label="Flights (this month)" value={kpi.flights} onClick={() => setKpiDetail({ type: "flights" })} />
        <StatCard tone="sky" icon="🌅" label="Morning Today" value={kpi.assignedToday.M} onClick={() => setKpiDetail({ type: "shift", bucket: "M", label: "Morning" })} />
        <StatCard tone="green" icon="☀️" label="Afternoon Today" value={kpi.assignedToday.A} onClick={() => setKpiDetail({ type: "shift", bucket: "A", label: "Afternoon" })} />
        <StatCard tone="purple" icon="🌙" label="Night Today" value={kpi.assignedToday.N} onClick={() => setKpiDetail({ type: "shift", bucket: "N", label: "Night" })} />
        <StatCard tone={kpi.conflicts > 0 ? "red" : "neutral"} icon="⚠️" label="Conflicts" value={kpi.conflicts} onClick={() => setKpiDetail({ type: "conflicts" })} />
        <StatCard tone={kpi.coveragePct >= 90 ? "green" : kpi.coveragePct >= 70 ? "amber" : "red"} icon="📈" label="Coverage" value={`${kpi.coveragePct}%`} />
      </div>

      {/* Shift legend */}
      {legendDefs.length > 0 && (
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="legend-row">
            {legendDefs.map(d => (
              <div key={d.code} className="legend-chip">
                <span className="legend-swatch" style={{ background: d.color }} />
                <span className="legend-code">{d.code}</span>
                <span>{d.name}</span>
                {d.startTime && <span className="legend-time">{d.startTime}–{d.endTime}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ab info" style={{ marginBottom: 9 }}>
        ℹ {monthKey} · {visibleStaff.length} staff shown · {dayRange.length} day{dayRange.length === 1 ? "" : "s"} visible
        {canEdit
          ? ` · Click to select (shift+click for a range), double-click to edit · Delete clears · Ctrl+C/X/V copy/cut/paste${selectedCells.size ? ` · ${selectedCells.size} selected${clipboard ? (clipboard.isCut ? " · cut pending" : " · copied") : ""}` : ""}`
          : isReadOnly ? " · Read-only (subscription required — see banner above)" : " · View-only"}
      </div>

      <div className="roster-wrap" ref={scrollElRef} style={shouldVirtualize ? { maxHeight: "min(72vh, 780px)", overflow: "auto" } : undefined}>
        <table className="rt">
          <thead>
            <tr>
              <th className="sc">Staff</th>
              <th className="sc2">Cat</th>
              {dayRange.map(day => (
                <th key={day} className={dayCellClasses(monthKey, day, todayDayNum)}>
                  <div>{day}</div>
                  <div style={{ fontSize: 7, fontWeight: 600, opacity: .75 }}>{WEEKDAY_LETTERS[dateAt(monthKey, day).getUTCDay()]}</div>
                </th>
              ))}
              {viewMode === "month" && weekBlocks(nDays).map((wk, i) => <th key={i}>W{i + 1}</th>)}
              {viewMode === "month" && <th>Tot</th>}
            </tr>
          </thead>
          <tbody>
            {shouldVirtualize ? (
              <>
                {paddingTop > 0 && <tr aria-hidden="true"><td style={{ height: paddingTop, padding: 0, border: 0 }} colSpan={totalCols} /></tr>}
                {virtualRows.map(vi => {
                  const item = renderItems[vi.index];
                  if (item.type === "header") {
                    return <CategoryHeaderRow key={item.key} cat={item.cat} count={item.count} colSpan={totalCols} />;
                  }
                  const s = staffById.get(item.staffId);
                  if (!s) return null;
                  return (
                    <RosterRow
                      key={item.key} userId={s.id} fullName={s.fullName} designation={s.designation} cat={item.cat}
                      isBlocked={!!s.isBlocked} blockReason={(s.blockReasons || []).join("; ")}
                      shiftAssignments={s.shiftAssignments} nDays={nDays} dayRange={dayRange} monthKey={monthKey}
                      shiftDefByCode={shiftDefByCode} showTotals={viewMode === "month"}
                      selectedCells={selectedCells} cutPendingKeys={clipboard?.isCut ? clipboard.sourceKeys : null}
                      cellKey={cellKey} onCellClick={handleCellSelect} onCellDoubleClick={openCell} onStaffClick={setSelectedStaffId}
                      todayDayNum={todayDayNum}
                    />
                  );
                })}
                {paddingBottom > 0 && <tr aria-hidden="true"><td style={{ height: paddingBottom, padding: 0, border: 0 }} colSpan={totalCols} /></tr>}
              </>
            ) : (
              byCategory.map(group => (
                <RosterCategoryGroup
                  key={group.cat} group={group} nDays={nDays} dayRange={dayRange} monthKey={monthKey}
                  shiftDefByCode={shiftDefByCode} onCellClick={handleCellSelect} onCellDoubleClick={openCell} onStaffClick={setSelectedStaffId}
                  todayDayNum={todayDayNum} showTotals={viewMode === "month"}
                  selectedCells={selectedCells} cutPendingKeys={clipboard?.isCut ? clipboard.sourceKeys : null} cellKey={cellKey}
                />
              ))
            )}
            <CoverageRows staff={visibleStaff} dayRange={dayRange} monthKey={monthKey} todayDayNum={todayDayNum} showTotals={viewMode === "month"} nDays={nDays} />
          </tbody>
        </table>
      </div>

      {/* Daily Coverage + Coverage Status + Roster Validation */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginTop: 14 }}>
        <DailyCoverageCard staff={visibleStaff} dayRange={dayRange} monthKey={monthKey} shiftDefByCode={shiftDefByCode} mandatoryRules={mandatoryRules} todayDayNum={todayDayNum} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <CoverageStatusCard coveragePct={kpi.coveragePct} conflicts={kpi.conflicts} />
          <RosterValidationCard
            violations={violations} showAll={showAllIssues} onToggleAll={() => setShowAllIssues(v => !v)}
            onFixAutomatically={() => navigate("/auto-roster")}
          />
        </div>
      </div>

      {editingCell && (
        <ShiftEditModal
          cell={editingCell} shiftDefs={shiftDefs} staff={staff} monthKey={monthKey} mandatoryRules={mandatoryRules}
          onSave={saveCell} onClose={() => setEditingCell(null)}
        />
      )}

      {selectedStaff && (
        <StaffDetailDrawer
          staff={selectedStaff} monthKey={monthKey} nDays={nDays} shiftDefByCode={shiftDefByCode}
          onClose={() => setSelectedStaff(null)}
          onEditToday={(s) => { setSelectedStaff(null); openCell(s.id, todayDayNum || 1); }}
        />
      )}

      {showVersions && roster && (
        <RosterVersionsPanel
          stationId={stationId} monthKey={monthKey}
          onClose={() => setShowVersions(false)}
          onRestored={async () => { setShowVersions(false); await load(); }}
        />
      )}

      {showImportWizard && (
        <RosterImportWizard
          stationId={stationId} monthKey={monthKey}
          onClose={() => setShowImportWizard(false)}
          onImported={async () => { setShowImportWizard(false); await load(); }}
        />
      )}

      {kpiDetail?.type === "shift" && (
        <KpiDetailModal title={`${kpiDetail.label} · On Duty Today`} onClose={() => setKpiDetail(null)}>
          {(() => {
            const rows = staffOnDutyToday(kpiDetail.bucket);
            if (!rows.length) return <div className="empty-note">No one is on {kpiDetail.label.toLowerCase()} duty today.</div>;
            return rows.map(r => (
              <button
                key={r.id} className="staff-name-btn" style={{ width: "100%" }}
                onClick={() => { setKpiDetail(null); const s = staff.find(x => x.id === r.id); if (s) setSelectedStaff(s); }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <div>
                    <div className="sn">{r.fullName}</div>
                    <div className="sr">{r.time ? `${r.code} · ${r.time}` : r.code}</div>
                  </div>
                  <span className={`cat-tag cat-${r.category}`}>{r.category}</span>
                </div>
              </button>
            ));
          })()}
        </KpiDetailModal>
      )}

      {kpiDetail?.type === "flights" && (
        <KpiDetailModal title="Flights (this month) · Day by Day" onClose={() => setKpiDetail(null)} width={480}>
          <FlightsKpiDetail stationId={stationId} monthKey={monthKey} onGoToImport={() => navigate("/flight-schedule")} />
        </KpiDetailModal>
      )}

      {kpiDetail?.type === "conflicts" && (
        <KpiDetailModal title={`Conflicts (${violations.length})`} onClose={() => setKpiDetail(null)}>
          {violations.length === 0 ? (
            <div className="empty-note">✅ No conflicts this month.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {violations.map((v, i) => (
                <div key={i} className="alert-card red">
                  <span>⚠</span>
                  <div>
                    <div className="alert-card-title">{v.date} · {v.shift}</div>
                    <div className="alert-card-sub">{v.issue}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </KpiDetailModal>
      )}
    </div>
  );
}

function KpiDetailModal({ title, onClose, children, width = 420 }) {
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="popover-card" style={{ width, maxHeight: "70vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="card-title" style={{ marginBottom: 10 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
      </div>
    </div>
  );
}

const WEEKDAY_SHORT_KPI = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Day-by-day breakdown behind the "Flights (this month)" KPI — reuses the
// same GET /api/flight-schedule the Flight Schedule tab's own day view
// already reads (FlightScheduleManager.jsx), just a compact list here
// instead of that page's full import UI, since this popover is a "show me
// what makes up that number" drill-down, not another place to import from.
function FlightsKpiDetail({ stationId, monthKey, onGoToImport }) {
  const [schedule, setSchedule] = useState(null);
  const [error, setError] = useState("");
  const [expandedDay, setExpandedDay] = useState(null);
  const [year, month] = monthKey.split("-").map(Number);

  useEffect(() => {
    if (!stationId) return;
    setSchedule(null);
    setError("");
    flightScheduleApi.getFlightSchedule(stationId, year, month).then(setSchedule).catch(err => setError(err.message));
  }, [stationId, year, month]);

  if (error) return <div className="empty-note">{error}</div>;
  if (!schedule) return <div className="empty-note">Loading…</div>;
  if (!schedule.imported) {
    return (
      <div className="empty-note">
        No Flight Schedule imported for {monthLabel(monthKey)} yet.
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, display: "block" }} onClick={onGoToImport}>
          Go to Flight Schedule →
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
        {schedule.summary.totalMovements} total movement{schedule.summary.totalMovements === 1 ? "" : "s"} · {schedule.summary.operatingDays} operating day{schedule.summary.operatingDays === 1 ? "" : "s"} of {schedule.daysInMonth} · click a day to expand
      </div>
      {Array.from({ length: schedule.daysInMonth }, (_, i) => i + 1).map(d => {
        const weekday = WEEKDAY_SHORT_KPI[new Date(year, month - 1, d).getDay()];
        const flights = schedule.byDay[d] || [];
        const isOpen = expandedDay === d;
        return (
          <div key={d} style={{ borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 2px", cursor: "pointer" }} onClick={() => setExpandedDay(isOpen ? null : d)}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--cyan)" }}>{isOpen ? "▼" : "▶"} Day {d} ({weekday})</span>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{flights.length} flight{flights.length === 1 ? "" : "s"}</span>
            </div>
            {isOpen && (
              <div style={{ paddingLeft: 14, paddingBottom: 6 }}>
                {flights.length === 0 ? <div style={{ fontSize: 9, color: "var(--text-dim)" }}>No flights this day.</div> : flights.map((f, i) => (
                  <div key={i} style={{ fontSize: 9, color: "var(--text-dim)", display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                    <span>{f.type === "Turn" ? "🔄" : "🛩"} {f.flightRef} <span>{f.route}</span></span>
                    <span>{f.arr !== "-" ? `Arr ${f.arr}` : ""} {f.dep !== "-" ? `Dep ${f.dep}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

const navBtnStyle = { width: 24, height: 24, borderRadius: 5, background: "var(--glass)", border: "1px solid var(--border)", color: "var(--white)" };

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

function dayCellClasses(monthKey, day, todayDayNum) {
  const classes = [];
  if (isWeekend(monthKey, day)) classes.push("wknd");
  if (todayDayNum === day) classes.push("today");
  return classes.join(" ") || undefined;
}

function StatusPill({ roster }) {
  if (!roster) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: roster.isPublished ? "var(--green)" : "var(--amber)", display: "inline-block" }} />
      {roster.isPublished ? "Published" : "Draft"}
    </div>
  );
}

// The smart-autosave status indicator — reflects usePendingSaveQueue's
// shared state, not any single edit, since every cell edit on this page
// (single or bulk) now goes through that one queue.
function SaveStatusPill({ status, pendingCount, onRetry }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-dim)" }}>🟡 Saving{pendingCount ? `… (${pendingCount})` : "…"}</div>;
  }
  if (status === "error") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--rp-red)" }}>
        🔴 Unable to save changes — kept locally.
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  return <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--rp-green)" }}>🟢 Saved</div>;
}

function StatCard({ tone, icon, label, value, onClick }) {
  return (
    <div
      className={`stat-card ${tone}`}
      onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      style={onClick ? { cursor: "pointer" } : undefined}
      title={onClick ? `View ${label.toLowerCase()} detail` : undefined}
    >
      <div className="stat-label">{icon} {label}</div>
      <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
    </div>
  );
}

function CategoryHeaderRow({ cat, count, colSpan }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{ padding: "5px 7px", fontSize: 9, fontWeight: 700, color: "var(--text-dim)", background: "rgba(15,23,42,.025)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
      >
        <span className={`cat-tag cat-${cat}`}>{cat}</span> {CAT_LABELS[cat]} · {count} staff
      </td>
    </tr>
  );
}

// Non-virtualized path (small/typical rosters) — same header-then-rows
// shape as the virtualized path above, just rendering every row directly.
function RosterCategoryGroup({ group, nDays, dayRange, monthKey, shiftDefByCode, onCellClick, onCellDoubleClick, onStaffClick, todayDayNum, showTotals, selectedCells, cutPendingKeys, cellKey }) {
  const colSpan = dayRange.length + 2 + (showTotals ? weekBlocks(nDays).length + 1 : 0);
  return (
    <>
      <CategoryHeaderRow cat={group.cat} count={group.staff.length} colSpan={colSpan} />
      {group.staff.map(s => (
        <RosterRow
          key={s.id} userId={s.id} fullName={s.fullName} designation={s.designation} cat={group.cat}
          isBlocked={!!s.isBlocked} blockReason={(s.blockReasons || []).join("; ")}
          shiftAssignments={s.shiftAssignments} nDays={nDays} dayRange={dayRange} monthKey={monthKey}
          shiftDefByCode={shiftDefByCode} showTotals={showTotals}
          selectedCells={selectedCells} cutPendingKeys={cutPendingKeys} cellKey={cellKey}
          onCellClick={onCellClick} onCellDoubleClick={onCellDoubleClick} onStaffClick={onStaffClick}
          todayDayNum={todayDayNum}
        />
      ))}
    </>
  );
}

// One staff member's full row — the unit React.memo actually protects.
// `shiftAssignments` is the ONE prop here that changes reference when this
// staff member's own data changes (see applyAssignmentToStaff above); every
// other prop is either a primitive or a stable (useCallback'd / module-
// level) reference, so an edit to staff member X only ever re-renders X's
// own RosterRow — everyone else's `shiftAssignments` array kept its old
// reference and memo bails out before touching their DOM at all.
const RosterRow = memo(function RosterRow({
  userId, fullName, designation, cat, isBlocked, blockReason, shiftAssignments, nDays, dayRange, monthKey, shiftDefByCode,
  showTotals, selectedCells, cutPendingKeys, cellKey, onCellClick, onCellDoubleClick, onStaffClick, todayDayNum,
}) {
  useRenderCount(`RosterRow:${userId}`);

  // Resolve every day of the MONTH (not just the visible dayRange) so the
  // weekly-hour totals stay correct even while Week/Day view is only
  // rendering a subset of day columns.
  const assignmentsByDay = Array.from({ length: nDays }, (_, i) => {
    const dateStr = dateAt(monthKey, i + 1).toISOString().slice(0, 10);
    return shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
  });
  const blocks = weekBlocks(nDays);
  const weekHours = blocks.map(([from, to]) => {
    let hrs = 0;
    for (let day = from; day <= to; day++) {
      const a = assignmentsByDay[day - 1];
      hrs += shiftNetHours(shiftDefByCode[a?.shiftDef.code || "O"], a);
    }
    return hrs;
  });
  const totalHours = weekHours.reduce((a, b) => a + b, 0);

  return (
    <tr>
      <td className="sc">
        <button className="staff-name-btn" onClick={() => onStaffClick(userId)} title="View staff details">
          <div className="sn">
            {fullName.split("(")[0].trim().substring(0, 20)}
            {isBlocked && (
              <span title={`Blocked from duty — ${blockReason || "expired compliance record"}`} style={{ marginLeft: 4, color: "var(--rp-red)" }}>🔒</span>
            )}
          </div>
          <div className="sr">{designation}</div>
        </button>
      </td>
      <td className="sc2"><span className={`cat-tag cat-${cat}`}>{cat}</span></td>
      {dayRange.map(day => {
        const a = assignmentsByDay[day - 1];
        const code = a?.shiftDef.code || "O";
        const def = shiftDefByCode[code];
        const in1 = a?.in1 || def?.startTime || null;
        const out1 = a?.out1 || def?.endTime || null;
        const in2 = a?.in2 || null;
        const out2 = a?.out2 || null;
        const key = cellKey(userId, day);
        const isSelected = !!selectedCells?.has(key);
        const isCutPending = !!cutPendingKeys?.includes(key);
        const originalTitle = def ? `${def.name}${in1 ? `: ${in1}–${out1}${in2 && out2 ? `, ${in2}–${out2}` : ""}` : ""}` : code;
        // A display-only overlay — the real shift assignment underneath
        // (assignmentsByDay, used for weekHours/totalHours above) is never
        // touched, so as soon as isBlocked next computes false (the
        // expired record got renewed/updated), the cell goes right back
        // to showing the actual allocated shift with no restore step needed.
        return (
          <RosterCell
            key={day} userId={userId} day={day}
            code={isBlocked ? "🔒" : code}
            colorHex={isBlocked ? "rgba(220,38,38,.22)" : (def?.color || "rgba(180,180,180,.1)")}
            title={isBlocked ? `Blocked from duty — ${blockReason || "expired compliance record"}. Originally scheduled: ${originalTitle}` : originalTitle}
            in1={isBlocked ? null : in1} out1={isBlocked ? null : out1}
            in2={isBlocked ? null : in2} out2={isBlocked ? null : out2}
            isSelected={isSelected} isCutPending={isCutPending}
            dayClass={dayCellClasses(monthKey, day, todayDayNum)}
            onCellClick={onCellClick} onCellDoubleClick={onCellDoubleClick}
          />
        );
      })}
      {showTotals && weekHours.map((hrs, i) => (
        <td key={i}>
          <span className={hrs > 48 ? "hrs-over" : hrs > 42 ? "hrs-warn" : "hrs-ok"}>{hrs.toFixed(1)}</span>
        </td>
      ))}
      {showTotals && <td><span className={totalHours > 200 ? "hrs-warn" : "hrs-ok"}>{totalHours.toFixed(1)}</span></td>}
    </tr>
  );
});

// One day's cell — leaf-level memo receiving only primitives, so a
// shallow prop compare is a real equality check, not a reference check
// that always fails (which is what would happen if the parent still
// passed whole `assignment`/`shiftDef` objects down here).
const RosterCell = memo(function RosterCell({ userId, day, code, colorHex, title, in1, out1, in2, out2, isSelected, isCutPending, dayClass, onCellClick, onCellDoubleClick }) {
  useRenderCount(`RosterCell:${userId}:${day}`);
  return (
    <td className={dayClass}>
      <div
        className={`sp${isSelected ? " cell-selected" : ""}${isCutPending ? " cell-cut" : ""}`}
        onClick={(e) => onCellClick(userId, day, e)}
        onDoubleClick={() => onCellDoubleClick(userId, day)}
        title={title}
        style={{ background: colorHex, color: "#000" }}
      >
        <span className="sc-code">{code}</span>
        {in1 && <span className="sc-time">{in1}–{out1}</span>}
        {in2 && out2 && <span className="sc-time">{in2}–{out2}</span>}
      </div>
    </td>
  );
});

// Mirrors the prototype's coverage rows — per-day count of staff on each
// shift, so gaps are visible at a glance without opening the dashboard.
function CoverageRows({ staff, dayRange, monthKey, todayDayNum, showTotals, nDays }) {
  return (
    <>
      {SHIFT_KEYS.map(sh => (
        <tr key={sh.key}>
          <td className="sc" style={{ fontSize: 8, fontWeight: 700, color: "var(--text-dim)" }}>{sh.label} Coverage</td>
          <td className="sc2"></td>
          {dayRange.map(day => {
            const dateStr = dateAt(monthKey, day).toISOString().slice(0, 10);
            const count = staff.filter(s => s.shiftAssignments.some(sa =>
              new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr && sa.shiftDef.code === sh.key
            )).length;
            return (
              <td key={day} className={dayCellClasses(monthKey, day, todayDayNum)}>
                <span className="cov-badge" style={{ opacity: count > 0 ? 1 : 0.3, color: count < 1 ? "var(--rp-red)" : "inherit" }}>
                  {count}
                </span>
              </td>
            );
          })}
          {showTotals && <td colSpan={weekBlocks(nDays).length + 1}></td>}
        </tr>
      ))}
    </>
  );
}

// Required comes from the enabled Mandatory Coverage rules (Workload Config
// → Rule Builder's own minimum-staffing source), summed per shift across
// every category — never an invented target. Assigned is the real count of
// staff on that shift that day, same computation the in-grid coverage rows
// above use.
function DailyCoverageCard({ staff, dayRange, monthKey, shiftDefByCode, mandatoryRules, todayDayNum }) {
  const requiredByShift = useMemo(() => {
    const req = { M: 0, A: 0, N: 0 };
    mandatoryRules.filter(r => r.enabled).forEach(r => { if (req[r.shift] != null) req[r.shift] += r.minCount; });
    return req;
  }, [mandatoryRules]);

  const assignedByDayShift = useMemo(() => {
    return dayRange.map(day => {
      const dateStr = dateAt(monthKey, day).toISOString().slice(0, 10);
      const counts = { M: 0, A: 0, N: 0 };
      for (const s of staff) {
        const a = s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
        const bucket = a && shiftBucket(a.shiftDef.code, shiftDefByCode[a.shiftDef.code]);
        if (bucket) counts[bucket]++;
      }
      return { day, counts };
    });
  }, [staff, dayRange, monthKey, shiftDefByCode]);

  const hasRules = mandatoryRules.some(r => r.enabled);

  return (
    <div className="card">
      <div className="card-title">📅 Daily Coverage <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— Required vs Assigned Staff</span></div>
      {!hasRules && (
        <div className="empty-note">No mandatory coverage rules are enabled yet (Auto Generator → Rule Builder) — showing assigned counts only.</div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="dc-table">
          <thead>
            <tr>
              <th>Shift</th>
              {dayRange.map(day => <th key={day} style={{ fontWeight: todayDayNum === day ? 800 : 700, color: todayDayNum === day ? "var(--sky)" : undefined }}>{day}</th>)}
            </tr>
          </thead>
          <tbody>
            {SHIFT_KEYS.map(sh => (
              <tr key={sh.key}>
                <td>{sh.label}{hasRules ? ` (Req ${requiredByShift[sh.key]})` : ""}</td>
                {assignedByDayShift.map(({ day, counts }) => {
                  const assigned = counts[sh.key];
                  const required = requiredByShift[sh.key];
                  const short = hasRules && required > 0 && assigned < required;
                  return <td key={day} className={short ? "dc-short" : hasRules && required > 0 ? "dc-ok" : undefined}>{assigned}</td>;
                })}
              </tr>
            ))}
            <tr>
              <td>Total</td>
              {assignedByDayShift.map(({ day, counts }) => <td key={day}>{counts.M + counts.A + counts.N}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoverageStatusCard({ coveragePct, conflicts }) {
  const circumference = 2 * Math.PI * 34;
  const offset = circumference - (coveragePct / 100) * circumference;
  const color = coveragePct >= 90 ? "var(--rp-green)" : coveragePct >= 70 ? "var(--amber)" : "var(--rp-red)";
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div className="card-title" style={{ justifyContent: "center" }}>Coverage Status</div>
      <div className="gauge-ring" style={{ width: 84, height: 84, margin: "4px auto" }}>
        <svg width={84} height={84}>
          <circle cx={42} cy={42} r={34} fill="none" stroke="rgba(15,23,42,.08)" strokeWidth={8} />
          <circle cx={42} cy={42} r={34} fill="none" stroke={color} strokeWidth={8} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <div className="gauge-ring-value" style={{ fontSize: 16 }}>{coveragePct}%</div>
      </div>
      <div style={{ fontSize: 11, marginTop: 6 }}>
        {conflicts === 0
          ? <span style={{ color: "var(--rp-green)" }}>🟢 Coverage acceptable</span>
          : <span style={{ color: "var(--rp-red)" }}>🔴 {conflicts} uncovered shift{conflicts === 1 ? "" : "s"}</span>}
      </div>
    </div>
  );
}

function RosterValidationCard({ violations, showAll, onToggleAll, onFixAutomatically }) {
  const shown = showAll ? violations : violations.slice(0, 3);
  return (
    <div className="card">
      <div className="card-title">Roster Validation</div>
      {violations.length === 0 ? (
        <div className="empty-note">✅ No issues detected this month.</div>
      ) : (
        <>
          <div className={`metric-badge ${violations.length > 5 ? "red" : "amber"}`} style={{ marginBottom: 8 }}>🔴 {violations.length} Issue{violations.length === 1 ? "" : "s"}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {shown.map((v, i) => (
              <div key={i} className="alert-card red">
                <span>⚠</span>
                <div>
                  <div className="alert-card-title">{v.date} · {v.shift}</div>
                  <div className="alert-card-sub">{v.issue}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
            {violations.length > 3 && (
              <button className="btn btn-ghost btn-sm" onClick={onToggleAll}>{showAll ? "Show Less" : `View All (${violations.length})`}</button>
            )}
            <button className="btn btn-primary btn-sm" onClick={onFixAutomatically} title="Opens Auto-Roster Generator — nothing is changed without your confirmation">🤖 Fix Automatically</button>
          </div>
        </>
      )}
    </div>
  );
}
