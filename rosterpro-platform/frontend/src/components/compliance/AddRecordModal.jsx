import { useState } from "react";
import * as complianceApi from "../../api/compliance.js";

const RECORD_TYPES = {
  qualification: {
    label: "Qualification", create: complianceApi.createQualification,
    fields: [
      { name: "qualCode", label: "Qualification Code", type: "text", placeholder: "e.g. B737 B1" },
      { name: "description", label: "Description", type: "text", optional: true },
      { name: "issuedDate", label: "Issued Date", type: "date" },
      { name: "expiryDate", label: "Expiry Date", type: "date" },
    ],
  },
  license: {
    label: "License", create: complianceApi.createLicense,
    fields: [
      { name: "licenseNo", label: "License Number", type: "text" },
      { name: "category", label: "Category", type: "text", placeholder: "e.g. B1" },
      { name: "issuingAuthority", label: "Issuing Authority", type: "text", placeholder: "DGCA" },
      { name: "issuedDate", label: "Issued Date", type: "date" },
      { name: "expiryDate", label: "Expiry Date", type: "date" },
    ],
  },
  training: {
    label: "Training", create: complianceApi.createTraining,
    fields: [
      { name: "courseName", label: "Course Name", type: "text" },
      { name: "provider", label: "Provider", type: "text", optional: true },
      { name: "completedDate", label: "Completed Date", type: "date" },
      { name: "validUntil", label: "Valid Until", type: "date", optional: true },
    ],
  },
  authorization: {
    label: "Authorization", create: complianceApi.createAuthorization,
    fields: [
      { name: "scope", label: "Scope", type: "text", placeholder: "e.g. B737-8 Line Maintenance" },
      { name: "grantedDate", label: "Granted Date", type: "date" },
      { name: "expiryDate", label: "Expiry Date", type: "date", optional: true },
    ],
  },
};

export default function AddRecordModal({ userId, onSaved, onClose }) {
  const [recordType, setRecordType] = useState("qualification");
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const def = RECORD_TYPES[recordType];

  function setField(name, value) {
    setValues(v => ({ ...v, [name]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await def.create({ userId, ...values });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">Add Compliance Record</div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Record Type</label>
          <select className="fi" value={recordType} onChange={(e) => { setRecordType(e.target.value); setValues({}); }}>
            {Object.entries(RECORD_TYPES).map(([key, d]) => <option key={key} value={key}>{d.label}</option>)}
          </select>
        </div>

        {def.fields.map(f => (
          <div className="fg" style={{ marginBottom: 12 }} key={f.name}>
            <label className="fl">{f.label}{f.optional ? " (optional)" : ""}</label>
            <input
              className="fi" type={f.type} placeholder={f.placeholder}
              value={values[f.name] || ""} onChange={(e) => setField(f.name, e.target.value)}
              required={!f.optional}
            />
          </div>
        ))}

        {error && <div className="l-err" style={{ display: "block", marginBottom: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "＋ Add Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
