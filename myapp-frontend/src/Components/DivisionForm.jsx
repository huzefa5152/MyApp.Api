import { useState } from "react";
import { createDivision, updateDivision, uploadDivisionLogo } from "../api/divisionApi";
import { notify } from "../utils/notify";
import { formStyles } from "../theme";

const {
  backdrop, modal, header, title, closeButton, body,
  error: errorStyle, formGroup, label, input, footer, cancel, submit,
} = formStyles;

const INT32_MAX = 2147483647;

/**
 * Create / edit a Division ("sub-company"). Mirrors the Company "General" tab:
 * branding + contact details + logo, plus the division's Sales Quote starting
 * number. Logo is uploaded separately (after the row exists), same as companies.
 */
export default function DivisionForm({ companyId, division, onClose, onSaved }) {
  const isEdit = !!division?.id;
  const [form, setForm] = useState({
    name: division?.name || "",
    brandName: division?.brandName || "",
    fullAddress: division?.fullAddress || "",
    phone: division?.phone || "",
    ntn: division?.ntn || "",
    cnic: division?.cnic || "",
    strn: division?.strn || "",
    email: division?.email || "",
    startingSalesQuoteNumber: division?.startingSalesQuoteNumber || 0,
  });
  const [logoFile, setLogoFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Division name is required."); return; }
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        brandName: form.brandName.trim() || null,
        fullAddress: form.fullAddress.trim() || null,
        phone: form.phone.trim() || null,
        ntn: form.ntn.trim() || null,
        cnic: form.cnic.trim() || null,
        strn: form.strn.trim() || null,
        email: form.email.trim() || null,
        startingSalesQuoteNumber: Number(form.startingSalesQuoteNumber) || 0,
      };
      let saved;
      if (isEdit) ({ data: saved } = await updateDivision(division.id, payload));
      else ({ data: saved } = await createDivision(companyId, payload));

      if (logoFile && saved?.id) {
        const fd = new FormData();
        fd.append("file", logoFile);
        await uploadDivisionLogo(saved.id, fd);
      }
      notify(`Division ${isEdit ? "updated" : "created"}.`, "success");
      onSaved?.();
    } catch (err) {
      setError(
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Failed to save division."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={{ ...modal, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <h3 style={title}>{isEdit ? `Edit Division — ${division.name}` : "New Division"}</h3>
          <button type="button" style={closeButton} onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={body}>
            {error && <div style={errorStyle}>{error}</div>}

            <div style={formGroup}>
              <label style={label}>Division Name *</label>
              <input style={input} value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus />
            </div>
            <div style={formGroup}>
              <label style={label}>Brand Name (for print header)</label>
              <input style={input} value={form.brandName} onChange={(e) => set("brandName", e.target.value)} />
            </div>
            <div style={formGroup}>
              <label style={label}>Logo</label>
              <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files[0])} style={{ ...input, padding: "0.4rem" }} />
              {division?.logoPath && !logoFile && (
                <img src={division.logoPath} alt="logo" style={{ marginTop: "0.5rem", height: 40 }} />
              )}
            </div>
            <div style={formGroup}>
              <label style={label}>Full Address</label>
              <textarea style={{ ...input, minHeight: 60, resize: "vertical" }} value={form.fullAddress} onChange={(e) => set("fullAddress", e.target.value)} />
            </div>
            <div style={formGroup}>
              <label style={label}>Phone</label>
              <input style={input} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div style={formGroup}>
              <label style={label}>NTN</label>
              <input style={input} value={form.ntn} onChange={(e) => set("ntn", e.target.value)} />
            </div>
            <div style={formGroup}>
              <label style={label}>CNIC</label>
              <input style={input} value={form.cnic} onChange={(e) => set("cnic", e.target.value)} />
            </div>
            <div style={formGroup}>
              <label style={label}>STRN</label>
              <input style={input} value={form.strn} onChange={(e) => set("strn", e.target.value)} />
            </div>
            <div style={formGroup}>
              <label style={label}>Email</label>
              <input type="email" style={input} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="e.g. sales@division.com" />
            </div>
            <div style={formGroup}>
              <label style={label}>Starting Sales Quote Number</label>
              <input type="number" min="0" max={INT32_MAX} style={input}
                value={form.startingSalesQuoteNumber}
                onChange={(e) => set("startingSalesQuoteNumber", e.target.value)} />
              <small style={{ color: "#5f6d7e", display: "block", marginTop: 4 }}>
                The first quote for this division starts here, then auto-increments.
                Quotes with no division use the company's own number.
              </small>
            </div>
          </div>
          <div style={footer}>
            <button type="button" style={cancel} onClick={onClose}>Cancel</button>
            <button type="submit" style={submit} disabled={busy}>
              {busy ? "Saving…" : isEdit ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
