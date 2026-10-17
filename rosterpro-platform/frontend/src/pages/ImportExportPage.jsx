import { useState, useRef } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import * as rosterApi from "../api/roster.js";
import * as staffApi from "../api/staff.js";
import { downloadReport, downloadBARoster, downloadPeopleStrongRoster, getPeopleStrongRosterWarnings } from "../api/reports.js";
import RosterImportWizard from "../components/roster/RosterImportWizard.jsx";

function todayMonthKey() { return new Date().toISOString().slice(0, 7); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

// One hidden <input type="file"> + a button that clicks it — the same
// upload trigger RosterPage.jsx already uses for its Import Excel button,
// factored out here since this page needs it four times.
function FileImportButton({ label, busy, disabled, onFile, accept = ".xlsx,.xls" }) {
  const ref = useRef(null);
  function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same filename later
    if (file) onFile(file);
  }
  return (
    <>
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={handleChange} />
      <button className="btn btn-primary" disabled={busy || disabled} onClick={() => ref.current?.click()}>
        {busy ? "Importing…" : label}
      </button>
    </>
  );
}

function ResultBanner({ result }) {
  if (!result) return null;
  const { tone, headline, lists = [] } = result;
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          padding: "8px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600,
          background: tone === "red" ? "rgba(229,57,53,.12)" : "rgba(0,200,83,.1)",
          color: tone === "red" ? "var(--rp-red)" : "var(--rp-green)",
        }}
      >
        {headline}
      </div>
      {lists.filter(l => l.items?.length).map(l => (
        <div key={l.label} style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
          <strong>{l.label}:</strong> {l.items.slice(0, 8).join("; ")}{l.items.length > 8 ? ` … +${l.items.length - 8} more` : ""}
        </div>
      ))}
    </div>
  );
}

export default function ImportExportPage() {
  const { stationId, currentStation } = useStation();
  const { hasPermission } = useAuth();

  usePageHeader({
    title: "Import / Export",
    subtitle: currentStation ? `${currentStation.name} · bulk data in and out` : "",
  });

  const canManageRoster = hasPermission("roster", "update");
  const canReadShift = hasPermission("shift", "read");
  const canUpdateStaff = hasPermission("staff", "update");
  const canExport = hasPermission("reports", "export");

  // ── Shift Definitions ──────────────────────────────────────────────────
  const [sdBusy, setSdBusy] = useState(false);
  const [sdResult, setSdResult] = useState(null);
  async function handleShiftDefImport(file) {
    setSdBusy(true); setSdResult(null);
    try {
      const r = await rosterApi.importShiftDefinitions(file, stationId);
      setSdResult({ tone: "green", headline: `Imported: ${r.created} created, ${r.updated} updated.` });
    } catch (err) {
      setSdResult({ tone: "red", headline: err.message, lists: [{ label: "Details", items: err.details || [] }] });
    } finally {
      setSdBusy(false);
    }
  }

  // ── Monthly Roster (reuses the existing import/export from the Roster
  // page — this just makes both reachable from one place, clearly labeled) ──
  const [rosterMonthKey, setRosterMonthKey] = useState(todayMonthKey());
  const [rosterExportBusy, setRosterExportBusy] = useState(false);
  const [rosterTemplateBusy, setRosterTemplateBusy] = useState(false);
  const [rosterResult, setRosterResult] = useState(null);
  const [showRosterWizard, setShowRosterWizard] = useState(false);
  async function handleRosterTemplate() {
    if (!stationId) return;
    setRosterTemplateBusy(true); setRosterResult(null);
    try {
      await downloadReport("roster-template", "excel", { stationId, monthKey: rosterMonthKey });
      setRosterResult({ tone: "green", headline: "Template downloaded — fill in shift codes per day, then Import Roster below." });
    } catch (err) {
      setRosterResult({ tone: "red", headline: err.message });
    } finally {
      setRosterTemplateBusy(false);
    }
  }
  async function handleRosterExport() {
    if (!stationId) return;
    setRosterExportBusy(true); setRosterResult(null);
    try {
      await downloadReport("roster", "excel", { stationId, monthKey: rosterMonthKey });
      setRosterResult({ tone: "green", headline: "Roster exported." });
    } catch (err) {
      setRosterResult({ tone: "red", headline: err.message });
    } finally {
      setRosterExportBusy(false);
    }
  }

  // ── Employee Master ──────────────────────────────────────────────────
  const [empBusy, setEmpBusy] = useState(false);
  const [empResult, setEmpResult] = useState(null);
  async function handleEmployeeMasterImport(file) {
    if (!stationId) return;
    setEmpBusy(true); setEmpResult(null);
    try {
      const r = await staffApi.importEmployeeMaster(stationId, file);
      const lists = [
        { label: "Not matched to any staff at this station", items: r.notFound },
        { label: "Skipped — Location didn't match this station", items: r.stationMismatch },
        { label: "Kept existing Staff No (file had a different one)", items: r.idKept },
        { label: "Row errors", items: r.rowErrors },
        { label: "Duplicate rows in file", items: r.duplicates },
        { label: "Role not recognized (left unchanged)", items: r.roleWarnings },
        { label: "L1 Manager not found (left unchanged)", items: r.l1ManagerWarnings },
      ];
      setEmpResult({ tone: "green", headline: `${r.updated} staff record(s) updated.`, lists });
    } catch (err) {
      setEmpResult({ tone: "red", headline: err.message });
    } finally {
      setEmpBusy(false);
    }
  }

  // ── BA Roster (already exists on the Reports page — reachable
  // here too, clearly labeled) ────────────────────────────────────────
  const [baFromDate, setBaFromDate] = useState(todayISO());
  const [baToDate, setBaToDate] = useState(todayISO());
  const [baBusy, setBaBusy] = useState(false);
  const [baResult, setBaResult] = useState(null);
  // Keep "To" from silently sitting before a newly-picked "From".
  function handleBaFromDateChange(value) {
    setBaFromDate(value);
    if (baToDate < value) setBaToDate(value);
  }
  async function handleBaExport() {
    if (!stationId) return;
    if (baToDate < baFromDate) { setBaResult({ tone: "red", headline: '"To" date is before "From" date.' }); return; }
    setBaBusy(true); setBaResult(null);
    try {
      await downloadBARoster(stationId, baFromDate, baToDate);
      setBaResult({ tone: "green", headline: baToDate === baFromDate ? "BA Roster exported." : "BA Roster exported for the whole period, in one file." });
    } catch (err) {
      setBaResult({ tone: "red", headline: err.message });
    } finally {
      setBaBusy(false);
    }
  }

  // ── PeopleStrong Biometric Roster ─────────────────────────────────────
  const [psMonthKey, setPsMonthKey] = useState(todayMonthKey());
  const [psBusy, setPsBusy] = useState(false);
  const [psResult, setPsResult] = useState(null);
  async function handlePeopleStrongExport() {
    if (!stationId) return;
    setPsBusy(true); setPsResult(null);
    try {
      // Checked alongside the actual download, not instead of it — a code
      // with no PeopleStrong mapping still comes back as a blank cell in
      // the file itself (never guessed at), so the file is always usable;
      // this just surfaces exactly which staff/days need a manual fix,
      // which the file alone wouldn't make obvious across a 30+ column grid.
      const [warningsResult] = await Promise.all([
        getPeopleStrongRosterWarnings(stationId, psMonthKey),
        downloadPeopleStrongRoster(stationId, psMonthKey),
      ]);
      const items = warningsResult.warnings.map(w => `${w.fullName} — ${w.date} (${w.code})`);
      setPsResult({
        tone: items.length ? "red" : "green",
        headline: items.length
          ? `Exported — but ${items.length} day(s) had no PeopleStrong shift mapping and were left blank. Fill these in by hand before uploading:`
          : `PeopleStrong Roster exported — all ${warningsResult.staffCount} staff mapped cleanly.`,
        lists: [{ label: "Needs manual fix", items }],
      });
    } catch (err) {
      setPsResult({ tone: "red", headline: err.message });
    } finally {
      setPsBusy(false);
    }
  }

  if (!stationId) {
    return <div className="ab info">No station has been set up yet — ask an administrator to add one first.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
      <div className="ab info">
        ℹ Every action below applies only to <strong>{currentStation?.name} ({currentStation?.iataCode})</strong> — switch stations to import or export a different one.
      </div>

      {(canReadShift || canManageRoster) && (
        <div className="card">
          <div className="card-title">🕐 Shift Definitions</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
            Airline-wide shift codes (Morning, Night, Off, …) — shared across every station, not specific to {currentStation?.name}.
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => rosterApi.downloadShiftDefinitionsTemplate()}>⬇ Download Template</button>
            {canReadShift && (
              <button className="btn btn-ghost" onClick={() => rosterApi.downloadShiftDefinitionsExport(stationId)}>⬇ Export Current</button>
            )}
            {canManageRoster && (
              <FileImportButton label="⬆ Import" busy={sdBusy} onFile={handleShiftDefImport} />
            )}
          </div>
          <ResultBanner result={sdResult} />
        </div>
      )}

      <div className="card">
        <div className="card-title">📅 Monthly Roster</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
          Staff × day shift grid for {currentStation?.name}. Import re-uses the exact format this export produces, so a round trip never loses data.
        </div>
        <div className="fg" style={{ marginBottom: 10, maxWidth: 200 }}>
          <label className="fl">Month</label>
          <input className="fi" type="month" value={rosterMonthKey} onChange={(e) => setRosterMonthKey(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {canExport && (
            <button
              className="btn btn-ghost" disabled={rosterTemplateBusy} onClick={handleRosterTemplate}
              title="Every active staff member for this month, one row each, every day blank (O) — fill in shift codes and re-import."
            >
              {rosterTemplateBusy ? "Downloading…" : "⬇ Download Template"}
            </button>
          )}
          {canExport && (
            <button className="btn btn-ghost" disabled={rosterExportBusy} onClick={handleRosterExport}>
              {rosterExportBusy ? "Exporting…" : "⬇ Export Roster"}
            </button>
          )}
          {canManageRoster && (
            <button className="btn btn-primary" onClick={() => setShowRosterWizard(true)}>⬆ Import Roster</button>
          )}
        </div>
        <ResultBanner result={rosterResult} />
        {showRosterWizard && (
          <RosterImportWizard
            stationId={stationId} monthKey={rosterMonthKey}
            onClose={() => setShowRosterWizard(false)}
            onImported={() => { setShowRosterWizard(false); setRosterResult({ tone: "green", headline: "Roster import committed — see Shift Roster for the updated grid, or Roster History to view the checkpoint." }); }}
          />
        )}
      </div>

      {canUpdateStaff && (
        <div className="card">
          <div className="card-title">🧑‍🔧 Employee Master</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
            Sync names, email, mobile number, designation, category, role, department and L1 Manager for {currentStation?.name}'s existing staff from an HR/master-data export. Matches by Staff No first, falling back to full name — never creates a new login, never moves anyone to another station.
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => staffApi.downloadEmployeeMasterTemplate()}>⬇ Download Template</button>
            <button className="btn btn-ghost" onClick={() => staffApi.exportEmployeeMaster(stationId)}>⬇ Export Current</button>
            <FileImportButton label="⬆ Import" busy={empBusy} onFile={handleEmployeeMasterImport} />
          </div>
          <ResultBanner result={empResult} />
        </div>
      )}

      {canExport && (
        <div className="card">
          <div className="card-title">🫁 BA Roster</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
            On-duty staff at {currentStation?.name}, formatted for the BA test portal upload — pick a single date, or a From/To range to export a longer period in one file.
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div className="fg" style={{ maxWidth: 200 }}>
              <label className="fl">From</label>
              <input className="fi" type="date" value={baFromDate} onChange={(e) => handleBaFromDateChange(e.target.value)} />
            </div>
            <div className="fg" style={{ maxWidth: 200 }}>
              <label className="fl">To</label>
              <input className="fi" type="date" value={baToDate} min={baFromDate} onChange={(e) => setBaToDate(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-ghost" disabled={baBusy} onClick={handleBaExport}>
            {baBusy ? "Exporting…" : "⬇ Export BA Roster"}
          </button>
          <ResultBanner result={baResult} />
        </div>
      )}

      {canExport && (
        <div className="card">
          <div className="card-title">🧬 PeopleStrong Biometric Roster</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
            A whole month's roster for {currentStation?.name}, formatted for the PeopleStrong portal's monthly biometric-attendance upload — every active staff member, including Stores. Morning/Afternoon/Night map to the matching M&amp;E 6/2 shift, Weekly Off stays Weekly Off, and Leave/Training/Deputation all map to the 19 Shift (09:00-17:30) admin slot.
          </div>
          <div className="fg" style={{ marginBottom: 10, maxWidth: 200 }}>
            <label className="fl">Month</label>
            <input className="fi" type="month" value={psMonthKey} onChange={(e) => setPsMonthKey(e.target.value)} />
          </div>
          <button className="btn btn-ghost" disabled={psBusy} onClick={handlePeopleStrongExport}>
            {psBusy ? "Exporting…" : "⬇ Export PeopleStrong Roster"}
          </button>
          <ResultBanner result={psResult} />
        </div>
      )}
    </div>
  );
}
