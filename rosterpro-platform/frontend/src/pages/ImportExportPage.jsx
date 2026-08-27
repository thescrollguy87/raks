import { useState, useRef } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import { useAuth } from "../store/AuthContext.jsx";
import * as rosterApi from "../api/roster.js";
import * as staffApi from "../api/staff.js";
import * as flightsApi from "../api/flights.js";
import { downloadReport, downloadBARoster } from "../api/reports.js";

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
  const canReadFlight = hasPermission("flight", "read");
  const canExport = hasPermission("reports", "export");

  // ── Shift Definitions ──────────────────────────────────────────────────
  const [sdBusy, setSdBusy] = useState(false);
  const [sdResult, setSdResult] = useState(null);
  async function handleShiftDefImport(file) {
    setSdBusy(true); setSdResult(null);
    try {
      const r = await rosterApi.importShiftDefinitions(file);
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
  const [rosterImportBusy, setRosterImportBusy] = useState(false);
  const [rosterExportBusy, setRosterExportBusy] = useState(false);
  const [rosterResult, setRosterResult] = useState(null);
  async function handleRosterImport(file) {
    if (!stationId) return;
    setRosterImportBusy(true); setRosterResult(null);
    try {
      const r = await rosterApi.importRoster(stationId, rosterMonthKey, file);
      const lists = [
        { label: "Not matched to any staff at this station", items: r.notFound },
        { label: "Unrecognized shift codes (skipped)", items: r.invalidCodes },
        { label: "Duplicate rows in file (last one used)", items: r.duplicates },
      ];
      setRosterResult({ tone: "green", headline: `Imported: ${r.staffUpdated} staff updated, ${r.assignmentCount} shifts.`, lists });
    } catch (err) {
      setRosterResult({ tone: "red", headline: err.message });
    } finally {
      setRosterImportBusy(false);
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
      ];
      setEmpResult({ tone: "green", headline: `${r.updated} staff record(s) updated.`, lists });
    } catch (err) {
      setEmpResult({ tone: "red", headline: err.message });
    } finally {
      setEmpBusy(false);
    }
  }

  // ── Flight Schedule ──────────────────────────────────────────────────
  const [flightMonthKey, setFlightMonthKey] = useState(todayMonthKey());
  const [flightBusy, setFlightBusy] = useState(false);
  const [flightResult, setFlightResult] = useState(null);
  async function handleFlightImport(file) {
    if (!stationId) return;
    setFlightBusy(true); setFlightResult(null);
    try {
      const r = await flightsApi.importFlightSchedule(stationId, flightMonthKey, file);
      const lists = [{ label: "Aircraft registration not found (flight saved without it)", items: r.aircraftNotFound }];
      setFlightResult({ tone: "green", headline: `${r.created} created, ${r.updated} updated (${r.occurrenceCount} flight occurrences this month).`, lists });
    } catch (err) {
      setFlightResult({ tone: "red", headline: err.message, lists: [{ label: "Details", items: err.details || [] }] });
    } finally {
      setFlightBusy(false);
    }
  }

  // ── Daily BA Roster (already exists on the Reports page — reachable
  // here too, clearly labeled) ────────────────────────────────────────
  const [baDate, setBaDate] = useState(todayISO());
  const [baBusy, setBaBusy] = useState(false);
  const [baResult, setBaResult] = useState(null);
  async function handleBaExport() {
    if (!stationId) return;
    setBaBusy(true); setBaResult(null);
    try {
      await downloadBARoster(stationId, baDate);
      setBaResult({ tone: "green", headline: "BA Roster exported." });
    } catch (err) {
      setBaResult({ tone: "red", headline: err.message });
    } finally {
      setBaBusy(false);
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
              <button className="btn btn-ghost" onClick={() => rosterApi.downloadShiftDefinitionsExport()}>⬇ Export Current</button>
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
            <button className="btn btn-ghost" disabled={rosterExportBusy} onClick={handleRosterExport}>
              {rosterExportBusy ? "Exporting…" : "⬇ Export Roster"}
            </button>
          )}
          {canManageRoster && (
            <FileImportButton label="⬆ Import Roster" busy={rosterImportBusy} onFile={handleRosterImport} />
          )}
        </div>
        <ResultBanner result={rosterResult} />
      </div>

      {canUpdateStaff && (
        <div className="card">
          <div className="card-title">🧑‍🔧 Employee Master</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
            Sync names, email, designation, category and department for {currentStation?.name}'s existing staff from an HR/master-data export. Matches by Staff No first, falling back to full name — never creates a new login, never moves anyone to another station.
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => staffApi.downloadEmployeeMasterTemplate()}>⬇ Download Template</button>
            <button className="btn btn-ghost" onClick={() => staffApi.exportEmployeeMaster(stationId)}>⬇ Export Current</button>
            <FileImportButton label="⬆ Import" busy={empBusy} onFile={handleEmployeeMasterImport} />
          </div>
          <ResultBanner result={empResult} />
        </div>
      )}

      {canReadFlight && (
        <div className="card">
          <div className="card-title">✈️ Flight Schedule</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
            A recurring monthly pattern ("Mon,Wed,Fri" or "Daily") expanded into individual flights for {currentStation?.name}. Re-importing the same file for the same month updates those flights instead of duplicating them.
          </div>
          <div className="fg" style={{ marginBottom: 10, maxWidth: 200 }}>
            <label className="fl">Month</label>
            <input className="fi" type="month" value={flightMonthKey} onChange={(e) => setFlightMonthKey(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => flightsApi.downloadFlightScheduleTemplate()}>⬇ Download Template</button>
            <FileImportButton label="⬆ Import" busy={flightBusy} onFile={handleFlightImport} />
          </div>
          <ResultBanner result={flightResult} />
        </div>
      )}

      {canExport && (
        <div className="card">
          <div className="card-title">🫁 Daily BA Roster</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12 }}>
            On-duty staff for one day at {currentStation?.name}, formatted for the BA test portal upload.
          </div>
          <div className="fg" style={{ marginBottom: 10, maxWidth: 200 }}>
            <label className="fl">Date</label>
            <input className="fi" type="date" value={baDate} onChange={(e) => setBaDate(e.target.value)} />
          </div>
          <button className="btn btn-ghost" disabled={baBusy} onClick={handleBaExport}>
            {baBusy ? "Exporting…" : "⬇ Export BA Roster"}
          </button>
          <ResultBanner result={baResult} />
        </div>
      )}
    </div>
  );
}
