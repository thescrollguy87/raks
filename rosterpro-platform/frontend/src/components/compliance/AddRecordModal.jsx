import { useState } from "react";
import * as complianceApi from "../../api/compliance.js";

const RECORD_TYPES = {
  qualification: {
    label: "Qualification", create: complianceApi.createQualification, update: complianceApi.updateQualification,
    fields: [
      { name: "qualCode", label: "Qualification Code", type: "text", placeholder: "e.g. B737 B1" },
      { name: "description", label: "Description", type: "text", optional: true },
      { name: "issuedDate", label: "Issued Date", type: "date" },
      { name: "expiryDate", label: "Expiry Date", type: "date" },
    ],
  },
  license: {
    label: "License", create: complianceApi.createLicense, update: complianceApi.updateLicense,
    fields: [
      { name: "licenseNo", label: "License Number", type: "text" },
      { name: "category", label: "Category", type: "text", placeholder: "e.g. B1" },
      { name: "issuingAuthority", label: "Issuing Authority", type: "text", placeholder: "DGCA" },
      { name: "issuedDate", label: "Issued Date", type: "date" },
      { name: "expiryDate", label: "Expiry Date", type: "date" },
    ],
  },
  training: {
    label: "Training", create: complianceApi.createTraining, update: complianceApi.updateTraining,
    fields: [
      { name: "courseName", label: "Course Name", type: "text" },
      { name: "provider", label: "Provider", type: "text", optional: true },
      { name: "completedDate", label: "Completed Date", type: "date" },
      { name: "validUntil", label: "Valid Until", type: "date", optional: true },
    ],
  },
  authorization: {
    label: "Authorization", create: complianceApi.createAuthorization, update: complianceApi.updateAuthorization,
    fields: [
      { name: "scope", label: "Scope", type: "text", placeholder: "e.g. B737-8 Line Maintenance" },
      { name: "grantedDate", label: "Granted Date", type: "date" },
      { name: "expiryDate", label: "Expiry Date", type: "date", optional: true },
    ],
  },
};

// The date fields on an existing record come back as full ISO timestamps
// (e.g. "2026-09-01T00:00:00.000Z") from the API, but a <input type="date">
// needs exactly "YYYY-MM-DD" or it renders blank.
function toDateInputValue(v) {
  return typeof v === "string" ? v.slice(0, 10) : "";
}

// Doubles as both "Add" and "Edit" — pass `editingRecord` ({ type, record })
// to prefill from an existing record and PATCH it instead of creating a new
// one; the record type is then fixed (editing a Qualification can't turn it
// into a License) so only the field values are editable.
export default function AddRecordModal({ userId, editingRecord, onSaved, onClose }) {
  const isEdit = !!editingRecord;
  const [recordType, setRecordType] = useState(editingRecord?.type || "qualification");
  const [values, setValues] = useState(() => {
    if (!editingRecord) return {};
    const def = RECORD_TYPES[editingRecord.type];
    return Object.fromEntries(def.fields.map(f => [f.name, f.type === "date" ? toDateInputValue(editingRecord.record[f.name]) : (editingRecord.record[f.name] ?? "")]));
  });
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
      if (isEdit) {
        await def.update(editingRecord.record.id, values);
      } else {
        await def.create({ userId, ...values });
      }
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
        <div className="modal-title">{isEdit ? `Edit ${def.label}` : "Add Compliance Record"}</div>

        <div className="fg" style={{ marginBottom: 12 }}>
          <label className="fl">Record Type</label>
          <select className="fi" value={recordType} disabled={isEdit} onChange={(e) => { setRecordType(e.target.value); setValues({}); }}>
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
            {saving ? "Saving…" : isEdit ? "Save Changes" : "＋ Add Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
