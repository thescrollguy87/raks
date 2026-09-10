import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../store/AuthContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useBillingReadOnly } from "../hooks/useBillingReadOnly.js";
import * as rosterApi from "../api/roster.js";
import * as workloadConfigApi from "../api/workloadConfig.js";
import { getDashboardSummary } from "../api/dashboard.js";
import { downloadReport } from "../api/reports.js";
import ShiftEditModal from "../components/roster/ShiftEditModal.jsx";
import StaffDetailDrawer from "../components/roster/StaffDetailDrawer.jsx";
import GenerationResultPanel from "../components/roster/GenerationResultPanel.jsx";
import { shiftNetHours, shiftBucket } from "../utils/shiftHours.js";

const CATEGORIES = ["B1", "B2", "CM", "NCS", "STO"];
const CAT_LABELS = { B1: "B1 AME", B2: "B2 AME", CM: "Certifying Mechanic", NCS: "NCS / Tech", STO: "Stores" };
const SHIFT_KEYS = [{ key: "M", label: "Morning" }, { key: "A", label: "Afternoon" }, { key: "N", label: "Night" }];

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
  const [importing, setImporting] = useState(false);
  const [exportingFormat, setExportingFormat] = useState(null); // null | "excel" | "pdf"
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const importInputRef = useRef(null);

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
      setLastSavedAt(new Date());
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
      setLastSavedAt(new Date());
      await load();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
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
        <>
          <input ref={importInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleImportFile} />
          <button className="btn btn-ghost" disabled={importing} onClick={() => importInputRef.current?.click()}>
            {importing ? "Importing…" : "⬆ Import"}
          </button>
        </>
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
  ), [canEdit, canExport, canGenerate, canPublish, canUnpublish, roster, generating, importing, exportingFormat, loading, monthKey, stationId]);

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
      currentIn1: assignment?.in1 || null, currentOut1: assignment?.out1 || null,
      currentIn2: assignment?.in2 || null, currentOut2: assignment?.out2 || null,
    });
  }

  async function saveCell({ shiftCode, reason, in1, out1, in2, out2 }) {
    await rosterApi.upsertShift(stationId, monthKey, {
      userId: editingCell.userId, shiftDate: editingCell.dateStr, shiftCode, reason, in1, out1, in2, out2,
    });
    setLastSavedAt(new Date());
    await load();
  }

  const cellKey = (userId, day) => `${userId}|${day}`;

  // Single click selects (Excel-style) — a separate, explicit double-click
  // opens the full edit modal (openCell) for setting times/notes. Shift+click
  // extends the current selection into a rectangle between the anchor and
  // the clicked cell, measured in row/column position so it's the visible
  // rectangle the user is looking at, same as an Excel range-select.
  function handleCellSelect(s, day, e) {
    if (!canEdit) return;
    if (e.shiftKey && selectionAnchor) {
      const rows = flatStaffOrder.map(st => st.id);
      const r1 = rows.indexOf(selectionAnchor.userId), r2 = rows.indexOf(s.id);
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
      setSelectionAnchor({ userId: s.id, day });
      setSelectedCells(new Set([cellKey(s.id, day)]));
    }
  }

  function assignmentFor(s, day) {
    const dateStr = dateAt(monthKey, day).toISOString().slice(0, 10);
    return s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
  }

  async function writeCells(assignments) {
    if (!assignments.length) return;
    await rosterApi.bulkUpsertShifts(stationId, monthKey, assignments);
    setLastSavedAt(new Date());
    await load();
  }

  // Delete/Backspace — clears every selected cell back to "O", the same
  // "no assignment" state a brand-new cell starts in.
  async function handleClearSelected() {
    if (!canEdit || !selectedCells.size) return;
    if (roster?.isPublished) { alert("Roster is published — unpublish before editing."); return; }
    const assignments = [...selectedCells].map(key => {
      const [userId, dayStr] = key.split("|");
      return { userId, shiftDate: dateAt(monthKey, Number(dayStr)).toISOString().slice(0, 10), shiftCode: "O" };
    });
    try {
      await writeCells(assignments);
    } catch (err) {
      alert(`Clear failed: ${err.message}`);
    }
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
      const s = flatStaffOrder.find(st => st.id === userId);
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
  // clears its source cells once the paste has actually landed.
  async function handlePaste() {
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

    try {
      await writeCells(assignments);
      if (clipboard.isCut && clipboard.sourceKeys) {
        const targetKeys = new Set(targets.map(t => cellKey(t.userId, t.day)));
        const toClear = clipboard.sourceKeys.filter(k => !targetKeys.has(k));
        if (toClear.length) {
          await writeCells(toClear.map(key => {
            const [userId, dayStr] = key.split("|");
            return { userId, shiftDate: dateAt(monthKey, Number(dayStr)).toISOString().slice(0, 10), shiftCode: "O" };
          }));
        }
        setClipboard(null);
      }
    } catch (err) {
      alert(`Paste failed: ${err.message}`);
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

  const q = search.trim().toLowerCase();
  const visibleStaff = staff
    .filter(s => catFilter === "ALL" || (s.category || "NCS") === catFilter)
    .filter(s => !q || s.fullName.toLowerCase().includes(q) || (s.designation || "").toLowerCase().includes(q));
  const byCategory = CATEGORIES.map(cat => ({ cat, staff: visibleStaff.filter(s => (s.category || "NCS") === cat) }))
    .filter(g => g.staff.length > 0);

  // Same row order the grid actually renders (grouped by category, same as
  // byCategory above) — selection/copy/paste measure "row N" against THIS,
  // not the unsorted staff list, so a shift-click range and a paste anchor
  // land on the row the user is actually looking at.
  const flatStaffOrder = byCategory.flatMap(g => g.staff);

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

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <StatusPill roster={roster} lastSavedAt={lastSavedAt} />
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
        <StatCard tone="sky" icon="✈️" label="Flights (this month)" value={kpi.flights} />
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

      <div className="roster-wrap">
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
            {byCategory.map(group => (
              <RosterCategoryGroup
                key={group.cat} group={group} nDays={nDays} dayRange={dayRange} monthKey={monthKey}
                shiftDefByCode={shiftDefByCode} onCellClick={handleCellSelect} onCellDoubleClick={openCell} onStaffClick={setSelectedStaff}
                todayDayNum={todayDayNum} showTotals={viewMode === "month"}
                selectedCells={selectedCells} cutPendingKeys={clipboard?.isCut ? clipboard.sourceKeys : null} cellKey={cellKey}
              />
            ))}
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
          onEditToday={(s) => { setSelectedStaff(null); openCell(s, todayDayNum || 1); }}
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

function KpiDetailModal({ title, onClose, children }) {
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="popover-card" style={{ width: 420, maxHeight: "70vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="card-title" style={{ marginBottom: 10 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
      </div>
    </div>
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

function StatusPill({ roster, lastSavedAt }) {
  if (!roster) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: roster.isPublished ? "var(--green)" : "var(--amber)", display: "inline-block" }} />
      {roster.isPublished ? "Published" : lastSavedAt ? `Draft saved ${relativeTime(lastSavedAt)}` : "Draft"}
    </div>
  );
}

function relativeTime(date) {
  const secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  return `${mins} min ago`;
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

function RosterCategoryGroup({ group, nDays, dayRange, monthKey, shiftDefByCode, onCellClick, onCellDoubleClick, onStaffClick, todayDayNum, showTotals, selectedCells, cutPendingKeys, cellKey }) {
  return (
    <>
      <tr>
        <td
          colSpan={dayRange.length + 2 + (showTotals ? weekBlocks(nDays).length + 1 : 0)}
          style={{ padding: "5px 7px", fontSize: 9, fontWeight: 700, color: "var(--text-dim)", background: "rgba(15,23,42,.025)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
        >
          <span className={`cat-tag cat-${group.cat}`}>{group.cat}</span> {CAT_LABELS[group.cat]} · {group.staff.length} staff
        </td>
      </tr>
      {group.staff.map(s => {
        // Resolve every day of the MONTH (not just the visible dayRange) so
        // the weekly-hour totals stay correct even while Week/Day view is
        // only rendering a subset of day columns.
        const assignmentsByDay = Array.from({ length: nDays }, (_, i) => {
          const dateStr = dateAt(monthKey, i + 1).toISOString().slice(0, 10);
          return s.shiftAssignments.find(sa => new Date(sa.shiftDate).toISOString().slice(0, 10) === dateStr);
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
          <tr key={s.id}>
            <td className="sc">
              <button className="staff-name-btn" onClick={() => onStaffClick(s)} title="View staff details">
                <div className="sn">{s.fullName.split("(")[0].trim().substring(0, 20)}</div>
                <div className="sr">{s.designation}</div>
              </button>
            </td>
            <td className="sc2"><span className={`cat-tag cat-${group.cat}`}>{group.cat}</span></td>
            {dayRange.map(day => {
              const a = assignmentsByDay[day - 1];
              const code = a?.shiftDef.code || "O";
              const def = shiftDefByCode[code];
              const in1 = a?.in1 || def?.startTime;
              const out1 = a?.out1 || def?.endTime;
              const key = cellKey(s.id, day);
              const isSelected = selectedCells?.has(key);
              const isCutPending = cutPendingKeys?.includes(key);
              return (
                <td key={day} className={dayCellClasses(monthKey, day, todayDayNum)}>
                  <div
                    className={`sp${isSelected ? " cell-selected" : ""}${isCutPending ? " cell-cut" : ""}`}
                    onClick={(e) => onCellClick(s, day, e)}
                    onDoubleClick={() => onCellDoubleClick(s, day)}
                    title={def ? `${def.name}${in1 ? `: ${in1}–${out1}${a?.in2 && a?.out2 ? `, ${a.in2}–${a.out2}` : ""}` : ""}` : code}
                    style={{ background: def?.color || "rgba(180,180,180,.1)", color: "#000" }}
                  >
                    <span className="sc-code">{code}</span>
                    {in1 && <span className="sc-time">{in1}–{out1}</span>}
                    {a?.in2 && a?.out2 && <span className="sc-time">{a.in2}–{a.out2}</span>}
                  </div>
                </td>
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
      })}
    </>
  );
}

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
