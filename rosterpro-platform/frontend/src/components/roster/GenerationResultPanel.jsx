// Shown after a successful generate — mirrors the prototype's post-
// generation summary card, now backed by the real algorithm's actual
// output instead of a client-side simulation.
export default function GenerationResultPanel({ result, onDismiss }) {
  const hasViolations = result.violations.length > 0;
  return (
    <div className="card" style={{ marginBottom: 12, borderColor: hasViolations ? "var(--amber)" : "var(--rp-green)" }}>
      <div className="card-title">
        {hasViolations ? "⚠️ Roster Generated — Coverage Gaps Found" : "✅ Roster Generated — Full Coverage"}
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 8, marginBottom: hasViolations ? 10 : 0, fontSize: 11 }}>
        <span>Staff: <strong>{result.staffCount}</strong></span>
        <span>Blocked (expired quals): <strong style={{ color: result.blockedCount > 0 ? "var(--rp-red)" : "inherit" }}>{result.blockedCount}</strong></span>
        <span>Shifts assigned: <strong>{result.assignmentCount}</strong></span>
        <span>Coverage gaps: <strong style={{ color: hasViolations ? "var(--amber)" : "var(--rp-green)" }}>{result.violations.length}</strong></span>
      </div>
      {hasViolations && (
        <div style={{ maxHeight: 160, overflowY: "auto", fontSize: 10, color: "var(--text-dim)" }}>
          {result.violations.map((v, i) => (
            <div key={i}>Day {v.day}, {v.shift} shift — missing {v.category}</div>
          ))}
          <div style={{ marginTop: 6, color: "var(--text-dim)" }}>
            These days need a manual assignment or an extra {[...new Set(result.violations.map(v => v.category))].join("/")} before publishing — the generator won't overwork or double-book an already-scheduled or resting staff member to force coverage.
          </div>
        </div>
      )}
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
