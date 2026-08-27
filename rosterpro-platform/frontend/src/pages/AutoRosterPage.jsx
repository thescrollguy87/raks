import { useState } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as rosterApi from "../api/roster.js";

const CAT_LABELS = { B1: "B1 AME", B2: "B2 AME", CM: "Certifying Mechanic", NCS: "NCS / Tech", STO: "Stores" };
const SHIFT_LABELS = { M: "Morning", A: "Afternoon", N: "Night" };

// The backend's roster generator (see rosterGenerationService.js) is fully
// automatic — it builds a fatigue-safe rotation from real staff/leave/
// qualification data rather than a manually-configured workload/pattern/
// allocation wizard. This page is the genuine "review before you commit"
// layer on top of that: preview computes the exact plan without writing
// anything, and Apply re-runs the same deterministic computation and
// actually saves it — there's no separate manual staffing/pattern input
// step because the algorithm doesn't consume one.
export default function AutoRosterPage() {
  const { stationId, currentStation } = useStation();
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [continueFromPrevious, setContinueFromPrevious] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(null);
  const [error, setError] = useState("");

  usePageHeader({ title: "Auto-Roster Generator", subtitle: currentStation ? `${currentStation.name} Line Maintenance` : "" });

  async function handlePreview() {
    setBusy(true);
    setError("");
    setApplied(null);
    try {
      const result = await rosterApi.generateRoster(stationId, monthKey, { preview: true, continueFromPrevious });
      setPreview(result);
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!confirm(`Apply this ${monthKey} roster? This assigns shifts for every active staff member — existing manual edits for this month will be overwritten.`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await rosterApi.generateRoster(stationId, monthKey, { continueFromPrevious });
      setApplied(result);
      setPreview(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
      <div className="card">
        <div className="card-title">1. Generate</div>
        <div className="fg2" style={{ marginBottom: 12 }}>
          <div className="fg">
            <label className="fl">Month</label>
            <input className="fi" type="month" value={monthKey} onChange={(e) => { setMonthKey(e.target.value); setPreview(null); setApplied(null); }} />
          </div>
          <div className="fg" style={{ justifyContent: "flex-end" }}>
            <label className="fl" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <input type="checkbox" checked={continueFromPrevious} onChange={(e) => setContinueFromPrevious(e.target.checked)} />
              Continue from Previous Roster
            </label>
          </div>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 12 }}>
          {continueFromPrevious
            ? "Looks at how each staff member's previous month actually ended (their real last few shifts) and continues the rest-gap rules from there — someone who finished last month on Night gets a rest day next, not thrown straight back onto Morning."
            : "Every staff member's rest-gap look-back starts fresh on day 1, as if everyone was OFF at the end of last month."}
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={handlePreview}>
          {busy ? "Working…" : "🤖 Preview Roster"}
        </button>
      </div>

      {error && <div className="ab" style={{ background: "rgba(229,57,53,.12)", color: "var(--rp-red)" }}>{error}</div>}

      {preview && (
        <div className="card" style={{ borderColor: preview.violations.length ? "var(--amber)" : "var(--rp-green)" }}>
          <div className="card-title">2. Review Manpower Plan {preview.violations.length ? "— Coverage Gaps Found" : "— Full Coverage"}</div>

          <div style={{ display: "flex", gap: 18, marginBottom: 12, fontSize: 11 }}>
            <span>Staff: <strong>{preview.staffCount}</strong></span>
            <span>Blocked (expired quals): <strong style={{ color: preview.blockedCount > 0 ? "var(--rp-red)" : "inherit" }}>{preview.blockedCount}</strong></span>
            <span>Shifts to assign: <strong>{preview.assignmentCount}</strong></span>
            <span>Coverage gaps: <strong style={{ color: preview.violations.length ? "var(--amber)" : "var(--rp-green)" }}>{preview.violations.length}</strong></span>
          </div>

          <div className="manpower-grid">
            {["M", "A", "N"].map(shift => (
              <div className="mp-card" key={shift}>
                <div className="mp-shift">{SHIFT_LABELS[shift]}</div>
                <div className="mp-total">{Object.values(preview.manpowerByShift[shift] || {}).reduce((a, b) => a + b, 0)}</div>
                <div className="mp-breakdown">
                  {Object.entries(preview.manpowerByShift[shift] || {}).map(([cat, n]) => `${CAT_LABELS[cat] || cat}: ${n}`).join(" · ") || "No staff assigned"}
                </div>
              </div>
            ))}
          </div>

          {preview.violations.length > 0 && (
            <div style={{ maxHeight: 180, overflowY: "auto", fontSize: 10, color: "var(--text-dim)", marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              {preview.violations.slice(0, 50).map((v, i) => (
                <div key={i}>Day {v.day}, {v.shift} shift — missing {v.category}</div>
              ))}
              {preview.violations.length > 50 && <div>+{preview.violations.length - 50} more</div>}
            </div>
          )}

          <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={handleApply}>
            {busy ? "Applying…" : "✅ Apply This Roster"}
          </button>
        </div>
      )}

      {applied && (
        <div className="card" style={{ borderColor: "var(--rp-green)" }}>
          <div className="card-title">✅ Applied — {monthKey} Roster Saved</div>
          <div style={{ fontSize: 11 }}>
            {applied.staffCount} staff, {applied.assignmentCount} shifts assigned, {applied.violations.length} coverage gaps remaining.
            Open <strong>Shift Roster</strong> to review or hand-edit individual cells, then Publish when ready.
          </div>
        </div>
      )}
    </div>
  );
}
