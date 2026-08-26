import { usePageHeader } from "../store/PageHeaderContext.jsx";

// Static/informational, unlike every other page in this app — there's no
// ShiftPattern-style "rules" table in the schema (deliberately: encoding
// "min 1 B1 per shift" as configurable data would be significant added
// complexity for rules that, in practice, come from DGCA regulation and
// don't change often). This page documents what's actually enforced in
// code right now, with a pointer to exactly where, so it can never drift
// out of sync with reality the way a hand-maintained policy doc would.
const RULES = [
  {
    title: "Minimum B1 AME coverage",
    description: "Every shift (Morning, Afternoon, Night) must have at least one B1-category AME assigned.",
    enforcedIn: "Roster generation algorithm & dashboard coverage widget",
  },
  {
    title: "Minimum B2 AME coverage at Night",
    description: "The Night shift specifically must have at least one B2-category AME assigned, in addition to the B1 requirement above.",
    enforcedIn: "Roster generation algorithm & dashboard coverage widget",
  },
  {
    title: "Rest gap: no Night immediately followed by Morning",
    description: "A staff member who worked a Night shift cannot be scheduled for the Morning shift the very next day — this rule takes priority over coverage convenience; an unfillable gap is reported rather than double-booking a fatigued engineer.",
    enforcedIn: "Roster generation algorithm",
  },
  {
    title: "Expired qualifications/licenses block duty",
    description: "A staff member with any expired qualification or license is automatically excluded from roster generation until the record is renewed.",
    enforcedIn: "Compliance service, checked by the roster generator",
  },
  {
    title: "Approved leave overrides scheduling",
    description: "Days a staff member has approved leave are never scheduled for duty, regardless of the rotation pattern.",
    enforcedIn: "Roster generation algorithm",
  },
  {
    title: "Published rosters are locked",
    description: "Once a roster is published, further edits (single-cell, bulk, or regeneration) are blocked until an explicit unpublish action — which requires a written reason and a separate permission from publishing.",
    enforcedIn: "Roster service",
  },
];

export default function ComplianceRulesPage() {
  usePageHeader({ title: "Compliance Rules", subtitle: "What's enforced, and where" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {RULES.map(rule => (
        <div className="card" key={rule.title}>
          <div className="card-title">⚖️ {rule.title}</div>
          <div style={{ fontSize: 11, marginTop: 6, marginBottom: 6 }}>{rule.description}</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Enforced in: {rule.enforcedIn}</div>
        </div>
      ))}
    </div>
  );
}
