import { usePageHeader } from "../store/PageHeaderContext.jsx";

// Ported verbatim from reference-ui/index.html's RULES array (DGCA / CAR-145
// Compliance Rules page) — same rules, same wording, not paraphrased.
const RULES = [
  { sev: "critical", title: "48-Hour Weekly Cap",
    desc: "Net duty hours must not exceed 48h in any rolling Mon-Sun 7-day window. Breaks excluded.",
    trigger: "Week hours > 48h", alert: "🔴 RED on week column + 🟡 YELLOW on day cells" },
  { sev: "critical", title: "N → M Illegal (11h rest breach)",
    desc: "Night ends 07:00; Morning starts 06:30. Gap = -30min. Mandatory 11h rest violated.",
    trigger: "Today=Morning, Yesterday=Night", alert: "🔴 RED on shift cell" },
  { sev: "critical", title: "A → M Illegal (11h rest breach)",
    desc: "Afternoon ends 21:30; Morning starts 06:30. Gap = 9h. Violates 11h minimum rest.",
    trigger: "Today=Morning, Yesterday=Afternoon", alert: "🔴 RED on shift cell" },
  { sev: "warning", title: "N → A Illegal (11h rest breach)",
    desc: "Night ends 07:00; Afternoon starts 13:30. Gap = 6.5h. Violates 11h rest.",
    trigger: "Today=Afternoon, Yesterday=Night", alert: "🟠 ORANGE on shift cell" },
  { sev: "critical", title: "2×Night → 2 OFF Days Mandatory",
    desc: "After two consecutive night shifts, employee must receive minimum 2 consecutive OFF/Leave days.",
    trigger: "D[-2]=N, D[-1]=N, D[0]≠OFF", alert: "🔴 RED on first missing rest day" },
  { sev: "critical", title: "Expired Qualification = Roster Block",
    desc: "If a staff member has any qualification/licence/medical marked 'Block on Expiry' that is expired, they cannot be rostered manually or by auto-roster on or after the expiry date.",
    trigger: "Qualification expiry date ≤ today", alert: "🔒 BLOCKED on shift cell · ⛔ on manual edit · excluded from auto-roster" },
  { sev: "warning", title: "Expiry Alert — 7 Days (configurable)",
    desc: "Qualification expiry alert fires configurable days before expiry. Default 7 days. Staff still active but action required.",
    trigger: "Days to expiry ≤ alert threshold", alert: "⚠️ Orange alert on dashboard + Qualifications page" },
  { sev: "info", title: "M → A is LEGAL (no flag)",
    desc: "Morning ends 14:00; Afternoon starts 13:30. No rest violation. Morning CAN precede Afternoon.",
    trigger: "Today=Afternoon, Yesterday=Morning", alert: "✅ No alert" },
  { sev: "info", title: "Min 1 B1/B2 per shift (coverage check)",
    desc: "At least one B1 or B2 AME must be present on each shift for aircraft release authority.",
    trigger: "Zero B1/B2 on any shift", alert: "📊 Coverage count shows 0 in red" },
];

const SEV_ICON = { critical: "🔴", warning: "🟠", info: "✅" };
const SEV_BORDER = {
  critical: "rgba(220,38,38,.35)",
  warning: "rgba(180,83,9,.3)",
  info: "rgba(22,163,74,.25)",
};

export default function ComplianceRulesPage() {
  usePageHeader({ title: "Compliance Rules", subtitle: "DGCA / CAR-145 Compliance Rules" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {RULES.map(rule => (
        <div className="card" style={{ borderLeft: `3px solid ${SEV_BORDER[rule.sev]}` }} key={rule.title}>
          <div className="card-title">
            {SEV_ICON[rule.sev]} {rule.title}
            <span className="tag" style={{ marginLeft: "auto" }}>{rule.sev.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 11, marginBottom: 6 }}>{rule.desc}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 10 }}>
            <div><span style={{ color: "var(--text-dim)" }}>Trigger: </span>{rule.trigger}</div>
            <div><span style={{ color: "var(--text-dim)" }}>Alert: </span>{rule.alert}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
