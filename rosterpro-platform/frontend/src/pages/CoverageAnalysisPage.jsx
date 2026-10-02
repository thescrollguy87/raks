import { useState, useEffect, Fragment } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { useStation } from "../store/StationContext.jsx";
import * as planningApi from "../api/rosterPlanning.js";
import { downloadReport } from "../api/reports.js";

const SHIFT_LABELS = { M: "Morning", A: "Afternoon", N: "Night" };
const CATEGORIES = ["B1", "B2", "CM", "NCS"];

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export default function CoverageAnalysisPage() {
  const { stationId, currentStation } = useStation();
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null); // `${category}-${shift}` | null

  usePageHeader({
    title: "Coverage Analysis",
    subtitle: currentStation ? `${currentStation.name} — already-generated roster vs. Mandatory Minimum Coverage` : "",
  });

  useEffect(() => {
    if (!stationId) return;
    setLoading(true);
    setError("");
    setExpandedRow(null);
    planningApi.getCoverageAnalysis(stationId, monthKey)
      .then(setAnalysis)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [stationId, monthKey]);

  async function handleDownload() {
    setReportBusy(true);
    try {
      await downloadReport("coverage-analysis", "excel", { stationId, monthKey });
    } catch (err) {
      alert(`Failed: ${err.message}`);
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="card-title">📊 Shift Roster Coverage Analysis</div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 10 }}>
          Reads the ALREADY-GENERATED roster for the selected month and checks what was actually scheduled against this station's configured Mandatory Minimum Coverage floors — per category, per shift, day by day. Where a floor is chronically unmet, it tells you whether that's a one-off rotation quirk or a structural headcount shortage no amount of rescheduling can fix, with a concrete suggestion either way.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="fg" style={{ margin: 0 }}>
            <label className="fl">Month</label>
            <input className="fi" type="month" value={monthKey} onChange={e => setMonthKey(e.target.value)} />
          </div>
          <button
            className="btn btn-primary btn-sm" style={{ marginTop: 16 }} disabled={reportBusy || !analysis?.generated}
            onClick={handleDownload}
          >
            {reportBusy ? "Generating…" : "📥 Download Detailed Report (Excel)"}
          </button>
        </div>
      </div>

      {error && <div className="ab red">{error}</div>}
      {loading && !error && <div className="card">Loading…</div>}

      {!loading && analysis && !analysis.generated && (
        <div className="ab amber">⚠ {analysis.message}</div>
      )}

      {!loading && analysis?.generated && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 10 }}>
            {CATEGORIES.map(cat => {
              const h = analysis.headcountByCategory[cat];
              return (
                <div className="card" key={cat}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", marginBottom: 4 }}>
                    <span className={`cat-tag cat-${cat}`}>{cat}</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{h.activeEffective} <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-dim)" }}>/ {h.total} active</span></div>
                  {h.fullMonthLeave.length > 0 && (
                    <div style={{ fontSize: 9, color: "var(--amber)", marginTop: 4 }} title={h.fullMonthLeave.join(", ")}>
                      🏖 {h.fullMonthLeave.length} on leave all month
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {analysis.notes.length > 0 && (
            <div className="ab amber" style={{ marginBottom: 10 }}>
              {analysis.notes.map((n, i) => <div key={i}>⚠ {n}</div>)}
            </div>
          )}

          <div className="card">
            <div className="card-title">Mandatory Minimum Coverage — Configured Floor vs. Real Coverage ({analysis.nDays} days)</div>
            {analysis.rows.length === 0 ? (
              <div className="empty-note">No Mandatory Minimum Coverage rules are enabled for this station — nothing to analyze.</div>
            ) : (
              <table className="rt" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Category</th><th>Shift</th><th>Floor</th><th>Min</th><th>Max</th><th>Avg</th><th>Gap Days</th><th>Suggestion</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.map(r => {
                    const rowKey = `${r.category}-${r.shift}`;
                    const short = r.gapDaysCount > 0;
                    return (
                      <Fragment key={rowKey}>
                        <tr style={{ background: short ? "rgba(245,166,35,.08)" : undefined }}>
                          <td><span className={`cat-tag cat-${r.category}`}>{r.category}</span></td>
                          <td>{SHIFT_LABELS[r.shift]}</td>
                          <td style={{ textAlign: "center" }}>{r.floor}</td>
                          <td style={{ textAlign: "center", color: r.min < r.floor ? "var(--rp-red)" : undefined, fontWeight: r.min < r.floor ? 700 : 400 }}>{r.min}</td>
                          <td style={{ textAlign: "center" }}>{r.max}</td>
                          <td style={{ textAlign: "center" }}>{r.avg}</td>
                          <td style={{ textAlign: "center" }}>
                            {short ? (
                              <button className="btn btn-ghost btn-sm" style={{ color: "var(--rp-red)", fontWeight: 700 }} onClick={() => setExpandedRow(expandedRow === rowKey ? null : rowKey)}>
                                {r.gapDaysCount} {expandedRow === rowKey ? "▲" : "▼"}
                              </button>
                            ) : <span style={{ color: "var(--rp-green)" }}>0</span>}
                          </td>
                          <td style={{ fontSize: 10, maxWidth: 360 }}>{r.suggestion || "—"}</td>
                        </tr>
                        {expandedRow === rowKey && (
                          <tr>
                            <td colSpan={8} style={{ background: "var(--navy-lite)", fontSize: 10, padding: "8px 10px" }}>
                              {r.gapDays.map(g => `Day ${g.day} (${g.actual}/${g.floor}, short ${g.shortfall})`).join("  ·  ")}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
