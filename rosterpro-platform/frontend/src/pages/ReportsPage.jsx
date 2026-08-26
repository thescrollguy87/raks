import { useState } from "react";
import { usePageHeader } from "../store/PageHeaderContext.jsx";
import { downloadReport, emailReport } from "../api/reports.js";
import { useStation } from "../store/StationContext.jsx";

const REPORT_TYPES = [
  { value: "roster", label: "Roster", needsMonth: true },
  { value: "compliance", label: "Compliance Status", needsMonth: false },
  { value: "leave", label: "Leave Balance", needsYear: true },
];
const FORMATS = [
  { value: "excel", label: "Excel (.xlsx)" },
  { value: "pdf", label: "PDF" },
  { value: "csv", label: "CSV" },
];

export default function ReportsPage() {
  const { stationId } = useStation();
  const [type, setType] = useState("roster");
  const [format, setFormat] = useState("excel");
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [year, setYear] = useState(new Date().getFullYear());
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  usePageHeader({ title: "Reports", subtitle: "Excel, PDF & CSV export" });

  const typeDef = REPORT_TYPES.find(t => t.value === type);
  const params = { stationId, ...(typeDef.needsMonth ? { monthKey } : {}), ...(typeDef.needsYear ? { year } : {}) };

  async function handleDownload() {
    setBusy(true);
    setMessage(null);
    try {
      await downloadReport(type, format, params);
      setMessage({ tone: "green", text: "Download started." });
    } catch (err) {
      setMessage({ tone: "red", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail() {
    if (!email) { setMessage({ tone: "red", text: "Enter a recipient email address" }); return; }
    setBusy(true);
    setMessage(null);
    try {
      await emailReport(type, format, params, email);
      setMessage({ tone: "green", text: `Report emailed to ${email}.` });
    } catch (err) {
      setMessage({ tone: "red", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <div className="card-title">Generate a Report</div>

      <div className="fg" style={{ margin: "12px 0" }}>
        <label className="fl">Report Type</label>
        <select className="fi" value={type} onChange={(e) => setType(e.target.value)}>
          {REPORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="fg" style={{ marginBottom: 12 }}>
        <label className="fl">Format</label>
        <select className="fi" value={format} onChange={(e) => setFormat(e.target.value)}>
          {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {typeDef.needsMonth && (
        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Month</label>
          <input className="fi" type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} />
        </div>
      )}
      {typeDef.needsYear && (
        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Year</label>
          <input className="fi" type="number" value={year} onChange={(e) => setYear(+e.target.value)} />
        </div>
      )}

      {message && (
        <div className="ab" style={{ background: message.tone === "green" ? "rgba(0,200,83,.1)" : "rgba(229,57,53,.12)", color: message.tone === "green" ? "var(--rp-green)" : "var(--rp-red)" }}>
          {message.text}
        </div>
      )}

      <div style={{ display: "flex", gap: 7, marginTop: 4 }}>
        <button className="btn btn-primary" disabled={busy} onClick={handleDownload}>⬇ Download</button>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 16 }}>
        <div className="fg" style={{ marginBottom: 10 }}>
          <label className="fl">Or email it to</label>
          <input className="fi" type="email" placeholder="name@airline.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button className="btn btn-ghost" disabled={busy} onClick={handleEmail}>✉ Email Report</button>
      </div>
    </div>
  );
}
