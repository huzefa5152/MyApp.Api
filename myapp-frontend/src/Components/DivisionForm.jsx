import { useState } from "react";
import { createDivision, updateDivision, uploadDivisionLogo } from "../api/divisionApi";
import { notify } from "../utils/notify";
import { formStyles } from "../theme";

const {
  backdrop, modal, header, title, closeButton, body,
  error: errorStyle, formGroup, label, input, footer, cancel, submit,
} = formStyles;

const INT32_MAX = 2147483647;

const TABS = [
  { id: "general", label: "General" },
  { id: "numbering", label: "Document Numbers" },
];

// Per-document numbering rows: [stateKey, currentKey, label].
const DOC_NUMBERS = [
  ["startingSalesQuoteNumber", "currentSalesQuoteNumber", "Sales Quote"],
  ["startingSalesOrderNumber", "currentSalesOrderNumber", "Sales Order"],
  ["startingChallanNumber", "currentChallanNumber", "Delivery Challan"],
  ["startingInvoiceNumber", "currentInvoiceNumber", "Sales Invoice"],
  ["startingPurchaseBillNumber", "currentPurchaseBillNumber", "Purchase Bill"],
  ["startingGoodsReceiptNumber", "currentGoodsReceiptNumber", "Goods Receipt"],
];

/**
 * Create / edit a Division ("sub-company"). Tabbed like the Company form:
 * "General" (branding + contact + logo) and "Document Numbers" (per-division
 * starting number for every document type; the current/last-issued number is
 * shown read-only). Logo uploads separately after the row exists.
 */
export default function DivisionForm({ companyId, division, onClose, onSaved }) {
  const isEdit = !!division?.id;
  const [activeTab, setActiveTab] = useState("general");
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
    startingSalesOrderNumber: division?.startingSalesOrderNumber || 0,
    startingChallanNumber: division?.startingChallanNumber || 0,
    startingInvoiceNumber: division?.startingInvoiceNumber || 0,
    startingPurchaseBillNumber: division?.startingPurchaseBillNumber || 0,
    startingGoodsReceiptNumber: division?.startingGoodsReceiptNumber || 0,
  });
  const [logoFile, setLogoFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setActiveTab("general"); setError("Division name is required."); return; }
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
        startingSalesOrderNumber: Number(form.startingSalesOrderNumber) || 0,
        startingChallanNumber: Number(form.startingChallanNumber) || 0,
        startingInvoiceNumber: Number(form.startingInvoiceNumber) || 0,
        startingPurchaseBillNumber: Number(form.startingPurchaseBillNumber) || 0,
        startingGoodsReceiptNumber: Number(form.startingGoodsReceiptNumber) || 0,
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

        <div style={tabBar}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              style={{ ...tabBtn, ...(activeTab === t.id ? tabBtnActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ ...body, maxHeight: "58vh", overflowY: "auto" }}>
            {error && <div style={errorStyle}>{error}</div>}

            {activeTab === "general" && (
              <>
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
              </>
            )}

            {activeTab === "numbering" && (
              <>
                <p style={{ fontSize: "0.82rem", color: "#5f6d7e", marginTop: 0 }}>
                  The first document of each type for this division starts at its <strong>Starting</strong> number,
                  then auto-increments. <strong>Current</strong> is the last number issued so far (read-only).
                  Documents with no division use the company's own numbers.
                </p>
                {DOC_NUMBERS.map(([sKey, cKey, lbl]) => (
                  <div key={sKey} className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div style={formGroup}>
                      <label style={label}>{lbl} — Starting</label>
                      <input type="number" min="0" max={INT32_MAX} style={input}
                        value={form[sKey]} onChange={(e) => set(sKey, e.target.value)} />
                    </div>
                    <div style={formGroup}>
                      <label style={label}>Current (issued)</label>
                      <input type="number" style={{ ...input, background: "#f3f5f8", color: "#5f6d7e" }}
                        value={division?.[cKey] ?? 0} readOnly disabled />
                    </div>
                  </div>
                ))}
              </>
            )}
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

const tabBar = { display: "flex", gap: "0.15rem", padding: "0 1rem", borderBottom: "1px solid #e8edf3", flexWrap: "wrap", backgroundColor: "#fff" };
const tabBtn = { padding: "0.6rem 0.85rem", border: "none", borderBottom: "2px solid transparent", background: "transparent", color: "#5f6d7e", fontSize: "0.84rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const tabBtnActive = { color: "#0d47a1", borderBottom: "2px solid #0d47a1" };
