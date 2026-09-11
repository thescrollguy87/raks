import { useRef, useState } from "react";
import { api } from "../../api/client.js";
import * as rosterApi from "../../api/roster.js";

// Multi-step Monthly Roster import: Upload -> Analyzing -> Validation
// Results (nothing written to the DB yet) -> Preview -> Commit -> Result.
// Only the Monthly Roster import uses this wizard — Employee Master and
// Flight Schedule import keep their existing single-step flows unchanged.
export default function RosterImportWizard({ stationId, monthKey, onClose, onImported }) {
  const [step, setStep] = useState("upload"); // upload | validating | results | committing | done
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState(null); // { jobId, summary, recognizedColumns, errors }
  const [error, setError] = useState("");
  const [commitResult, setCommitResult] = useState(null);
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  async function runValidate(f) {
    setFile(f);
    setStep("validating");
    setError("");
    try {
      const result = await api.upload(`/api/roster/import/validate?stationId=${stationId}&monthKey=${monthKey}`, undefined, f);
      setValidation(result);
      setStep("results");
    } catch (err) {
      setError(err.message || "Validation failed");
      setStep("upload");
    }
  }

  function handleFileInput(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) runValidate(f);
  }
  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) runValidate(f);
  }

  async function handleDownloadErrors() {
    try {
      const { blob, filename } = await api.download(`/api/roster/import/${validation.jobId}/errors/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    }
  }

  async function handleCommit() {
    setStep("committing");
    setError("");
    try {
      const result = await rosterApi.commitRosterImport(validation.jobId);
      setCommitResult(result);
      setStep("done");
    } catch (err) {
      setError(err.message || "Import failed");
      setStep("results");
    }
  }

  const s = validation?.summary;

  return (
    <div className="modal-overlay open" onClick={step === "validating" || step === "committing" ? undefined : onClose}>
      <div className="popover-card" style={{ width: 640, maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {step !== "validating" && step !== "committing" && <button className="modal-close" onClick={onClose}>✕</button>}
        <div className="card-title" style={{ marginBottom: 10 }}>⬆ Import Monthly Roster <span className="tag">{monthKey}</span></div>

        {error && <div className="ab red" style={{ marginBottom: 10 }}>{error}</div>}

        {step === "upload" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? "var(--sky)" : "var(--border)"}`, borderRadius: 10, padding: 32,
              textAlign: "center", background: dragOver ? "rgba(59,130,246,.06)" : "transparent",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>Drag & drop the Monthly Roster .xlsx file here, or</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleFileInput} />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Choose File</button>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 12 }}>
              Nothing is written to the roster until you review the results and confirm the import.
            </div>
          </div>
        )}

        {step === "validating" && (
          <div style={{ textAlign: "center", padding: 30 }}>
            <div style={{ fontSize: 12 }}>Reading {file?.name}…</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6 }}>Analyzing structure and validating every row — no data is written yet.</div>
          </div>
        )}

        {step === "results" && validation && (
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10 }}>
              <strong>{file?.name}</strong> · Recognized: {validation.recognizedColumns}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <SummaryChip label="Rows processed" value={s.totalRows} tone="neutral" />
              <SummaryChip label="Valid" value={s.validRows} tone="green" icon="✓" />
              <SummaryChip label="Warnings" value={s.warningRows} tone="amber" icon="⚠" />
              <SummaryChip label="Errors" value={s.errorRows} tone="red" icon="🔴" />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              <SummaryChip label="To create" value={s.createCount} tone="sky" />
              <SummaryChip label="To update" value={s.updateCount} tone="sky" />
              <SummaryChip label="Unchanged" value={s.unchangedCount} tone="neutral" />
            </div>

            {validation.errors.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>Issues found</div>
                  <button className="btn btn-ghost btn-sm" onClick={handleDownloadErrors}>⬇ Download Error Report</button>
                </div>
                <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                  {validation.errors.slice(0, 100).map((e, i) => (
                    <div key={i} style={{ fontSize: 10, padding: "5px 7px", borderRadius: 5, background: e.severity === "ERROR" ? "rgba(229,57,53,.08)" : "rgba(255,179,0,.1)" }}>
                      <strong>Row {e.rowNumber}</strong> · {e.field}: "{e.value}" — {e.message}
                      {e.suggestion && <div style={{ color: "var(--text-dim)" }}>→ {e.suggestion}</div>}
                    </div>
                  ))}
                  {validation.errors.length > 100 && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>… +{validation.errors.length - 100} more (see full report)</div>}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={s.validRows === 0} onClick={handleCommit}>
                Import {s.createCount + s.updateCount} Record{(s.createCount + s.updateCount) === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

        {step === "committing" && (
          <div style={{ textAlign: "center", padding: 30 }}>
            <div style={{ fontSize: 12 }}>Importing…</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6 }}>Checkpointing the current roster, then applying the validated changes in one transaction.</div>
          </div>
        )}

        {step === "done" && commitResult && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>✅ Import complete</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <SummaryChip label="Created" value={commitResult.createdCount} tone="green" />
              <SummaryChip label="Updated" value={commitResult.updatedCount} tone="sky" />
              <SummaryChip label="Unchanged" value={commitResult.unchangedCount} tone="neutral" />
              <SummaryChip label="Failed" value={commitResult.failedCount} tone={commitResult.failedCount ? "red" : "neutral"} />
            </div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 14 }}>
              A version checkpoint of the roster was created before this import — see Roster History to view or restore it.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => onImported?.()}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryChip({ label, value, tone, icon }) {
  const colors = {
    green: "var(--rp-green)", red: "var(--rp-red)", amber: "var(--amber)", sky: "var(--sky)", neutral: "var(--text-dim)",
  };
  return (
    <div style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(15,23,42,.04)", fontSize: 11 }}>
      <span style={{ color: colors[tone] || undefined, fontWeight: 700 }}>{icon ? `${icon} ` : ""}{value}</span> {label}
    </div>
  );
}
