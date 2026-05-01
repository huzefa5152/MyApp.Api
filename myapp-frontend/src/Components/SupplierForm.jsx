import { useState, useEffect } from "react";
import { createSupplier, createSupplierBatch, updateSupplier } from "../api/supplierApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { notify } from "../utils/notify";
import { formStyles } from "../theme";

const {
  backdrop, modal, header, title, closeButton,
  body, error: errorStyle, formGroup, label, input,
  footer, button, cancel, submit,
} = formStyles;

/**
 * Mirror of the per-company ClientForm with the same multi-company
 * picker semantics:
 *   • EDIT → single Supplier row, picker hidden.
 *   • CREATE → operator picks 1+ companies; selecting 2+ auto-collapses
 *     the new rows into a Common Supplier group via EnsureGroup.
 * When `companies` is empty / single, the picker is hidden and the
 * legacy single-company POST /api/suppliers path is used.
 */
export default function SupplierForm({ supplier, companyId, companies = [], onClose, onSaved }) {
  const empty = {
    id: null, name: "", address: "", email: "", phone: "",
    ntn: "", strn: "", site: "", registrationType: "", cnic: "",
    fbrProvinceCode: "",
  };
  const init = supplier
    ? {
        ...supplier,
        ntn: supplier.ntn || "",
        strn: supplier.strn || "",
        site: supplier.site || "",
        registrationType: supplier.registrationType || "",
        cnic: supplier.cnic || "",
        fbrProvinceCode: supplier.fbrProvinceCode ?? "",
      }
    : empty;
  const [formData, setFormData] = useState(init);
  const [errors, setErrors] = useState({});
  const [provinces, setProvinces] = useState([]);
  const [regTypes, setRegTypes] = useState([]);

  // Multi-company picker state — same shape as ClientForm.
  const isCreate = !supplier;
  const showCompanyPicker = isCreate && Array.isArray(companies) && companies.length > 1;
  const [selectedCompanyIds, setSelectedCompanyIds] = useState(() =>
    companyId ? [Number(companyId)] : []
  );
  useEffect(() => {
    if (isCreate && companyId) {
      setSelectedCompanyIds((prev) =>
        prev.length === 0 ? [Number(companyId)] : prev
      );
    }
  }, [companyId, isCreate]);
  const toggleCompany = (id) => {
    const n = Number(id);
    setSelectedCompanyIds((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]
    );
  };

  useEffect(() => {
    if (supplier) setFormData({
      ...supplier,
      ntn: supplier.ntn || "",
      strn: supplier.strn || "",
      site: supplier.site || "",
      registrationType: supplier.registrationType || "",
      cnic: supplier.cnic || "",
      fbrProvinceCode: supplier.fbrProvinceCode ?? "",
    });
  }, [supplier]);

  useEffect(() => {
    const load = async () => {
      try {
        const [provRes, regRes] = await Promise.all([
          getFbrLookupsByCategory("Province"),
          getFbrLookupsByCategory("RegistrationType"),
        ]);
        setProvinces(provRes.data);
        setRegTypes(regRes.data);
      } catch { /* ignore */ }
    };
    load();
  }, []);

  // Same registration-type → fields mapping as ClientForm.
  // Suppliers in Pakistan follow the same FBR taxonomy: Registered have
  // NTN+STRN; FTN entities have NTN only; Unregistered/CNIC vendors have
  // CNIC only.
  const regType = formData.registrationType;
  const showNtn  = regType === "Registered" || regType === "FTN";
  const showStrn = regType === "Registered";
  const showCnic = regType === "Unregistered" || regType === "CNIC";
  const ntnLabel = regType === "FTN" ? "FTN *" : "NTN *";

  const validate = () => {
    const next = {};
    if (!formData.name.trim()) next.name = "Name is required";
    if (showNtn && !formData.ntn.trim()) next.ntn = regType === "FTN" ? "FTN is required" : "NTN is required";
    if (showStrn && !formData.strn.trim()) next.strn = "STRN is required";
    if (showCnic && !formData.cnic.trim()) next.cnic = "CNIC is required for this registration type";
    if (showCnic && formData.cnic.trim() && formData.cnic.replace(/\D/g, "").length !== 13) {
      next.cnic = "CNIC must be 13 digits";
    }
    if (isCreate && showCompanyPicker && selectedCompanyIds.length === 0) {
      next.companies = "Pick at least one company.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "registrationType") {
      // Clear identity fields that no longer apply on type switch — see
      // ClientForm.handleChange for the rationale.
      const nextForm = { ...formData, registrationType: value };
      const willShowNtn  = value === "Registered" || value === "FTN";
      const willShowStrn = value === "Registered";
      const willShowCnic = value === "Unregistered" || value === "CNIC";
      if (!willShowNtn)  nextForm.ntn  = "";
      if (!willShowStrn) nextForm.strn = "";
      if (!willShowCnic) nextForm.cnic = "";
      setFormData(nextForm);
      setErrors({ ...errors, registrationType: "", ntn: "", strn: "", cnic: "" });
      return;
    }
    setFormData({ ...formData, [name]: value });
    setErrors({ ...errors, [name]: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const base = {
        ...formData,
        fbrProvinceCode: formData.fbrProvinceCode === "" ? null : Number(formData.fbrProvinceCode),
        registrationType: formData.registrationType || null,
        cnic: formData.cnic || null,
      };

      // EDIT — unchanged path.
      if (formData.id) {
        const { data } = await updateSupplier(formData.id, { ...base, companyId });
        onSaved(data);
        onClose();
        return;
      }

      // CREATE — multi-company batch when >1 companies are pickable.
      if (showCompanyPicker) {
        const { data } = await createSupplierBatch({ ...base, companyIds: selectedCompanyIds });
        const created = data.created || [];
        const skipped = data.skippedReasons || [];
        if (skipped.length > 0) notify(skipped.join(" "), "warning");
        if (created.length > 0) {
          notify(
            `Created ${created.length} supplier record${created.length !== 1 ? "s" : ""}` +
              (data.supplierGroupId ? " (linked as a Common Supplier)" : ""),
            "success"
          );
        }
        onSaved(created[0] || null);
      } else {
        const { data } = await createSupplier({ ...base, companyId });
        onSaved(data);
      }
      onClose();
    } catch (err) {
      notify(err.response?.data?.message || "Failed to save supplier.", "error");
    }
  };

  const fieldError = (name) =>
    errors[name] ? { border: "1px solid #dc3545" } : {};

  const errorMsg = (name) =>
    errors[name] ? <span style={{ color: "#dc3545", fontSize: "0.78rem", marginTop: "0.2rem", display: "block" }}>{errors[name]}</span> : null;

  return (
    <div style={backdrop}>
      <div style={modal}>
        <div style={header}>
          <h5 style={title}>{supplier ? "Edit Supplier" : "New Supplier"}</h5>
          <button style={closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div style={body}>
            {/* Multi-company picker — CREATE mode + parent supplied
                companies. Default-checked is the currently-active
                company so single-company creates stay one click;
                tapping extra chips spawns a Common Supplier group. */}
            {showCompanyPicker && (
              <div style={pickerStyles.box}>
                <div style={pickerStyles.headerRow}>
                  <span style={pickerStyles.title}>Create under which companies?</span>
                  <span style={pickerStyles.hint}>
                    Pick one to add this supplier to a single tenant, or 2+ to share it as a Common Supplier.
                  </span>
                </div>
                <div style={pickerStyles.chips}>
                  {companies.map((c) => {
                    const id = Number(c.id);
                    const checked = selectedCompanyIds.includes(id);
                    const lbl = c.brandName || c.name;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleCompany(id)}
                        style={{
                          ...pickerStyles.chip,
                          ...(checked ? pickerStyles.chipOn : pickerStyles.chipOff),
                        }}
                        title={checked ? `Tap to remove ${lbl}` : `Tap to include ${lbl}`}
                      >
                        {checked ? "✓ " : ""}{lbl}
                      </button>
                    );
                  })}
                </div>
                {errorMsg("companies")}
              </div>
            )}

            <div style={formGroup}>
              <label style={label}>Name *</label>
              <input type="text" name="name" value={formData.name} onChange={handleChange} style={{ ...input, ...fieldError("name") }} />
              {errorMsg("name")}
            </div>

            <div style={formGroup}>
              <label style={label}>Address</label>
              <input type="text" name="address" value={formData.address} onChange={handleChange} style={input} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={formGroup}>
                <label style={label}>Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} style={input} />
              </div>
              <div style={formGroup}>
                <label style={label}>Phone</label>
                <input type="text" name="phone" value={formData.phone} onChange={handleChange} style={input} />
              </div>
            </div>

            {/* FBR identity — pick Registration Type first; identity
                fields render below conditionally. Same model as
                ClientForm.  */}
            <div style={{ marginTop: "0.5rem", padding: "0.75rem", borderRadius: 10, border: "1px solid #00695c30", backgroundColor: "#e0f2f1" }}>
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.85rem", color: "#00695c" }}>FBR Details</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div style={formGroup}>
                  <label style={label}>Registration Type</label>
                  <select name="registrationType" value={formData.registrationType} onChange={handleChange} style={input}>
                    <option value="">Select...</option>
                    {regTypes.map((rt) => (
                      <option key={rt.id} value={rt.code}>{rt.label}</option>
                    ))}
                  </select>
                </div>
                <div style={formGroup}>
                  <label style={label}>Province</label>
                  <select name="fbrProvinceCode" value={formData.fbrProvinceCode} onChange={handleChange} style={input}>
                    <option value="">Select...</option>
                    {provinces.map((p) => (
                      <option key={p.id} value={p.code}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {!regType && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.78rem", color: "#5f6d7e" }}>
                  Pick a registration type to see the right identity fields.
                </p>
              )}

              {(showNtn || showStrn) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.5rem" }}>
                  {showNtn && (
                    <div style={formGroup}>
                      <label style={label}>{ntnLabel}</label>
                      <input
                        type="text"
                        name="ntn"
                        value={formData.ntn}
                        onChange={handleChange}
                        style={{ ...input, ...fieldError("ntn") }}
                        placeholder={regType === "FTN" ? "Federal Tax Number" : "7-digit NTN"}
                      />
                      {errorMsg("ntn")}
                    </div>
                  )}
                  {showStrn && (
                    <div style={formGroup}>
                      <label style={label}>STRN *</label>
                      <input
                        type="text"
                        name="strn"
                        value={formData.strn}
                        onChange={handleChange}
                        style={{ ...input, ...fieldError("strn") }}
                        placeholder="13-digit Sales Tax Registration Number"
                      />
                      {errorMsg("strn")}
                    </div>
                  )}
                </div>
              )}

              {showCnic && (
                <div style={{ ...formGroup, marginTop: "0.5rem" }}>
                  <label style={label}>CNIC (13 digits) *</label>
                  <input type="text" name="cnic" value={formData.cnic} onChange={handleChange} style={{ ...input, ...fieldError("cnic") }} placeholder="3520112345678" maxLength={13} />
                  {errorMsg("cnic")}
                  <span style={{ fontSize: "0.75rem", color: "#5f6d7e", marginTop: "0.2rem", display: "block" }}>
                    Unregistered vendors don't have NTN/STRN — CNIC is the FBR identity for individuals.
                  </span>
                </div>
              )}
            </div>
          </div>

          <div style={footer}>
            <button type="button" style={{ ...button, ...cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...button, ...submit }}>{supplier ? "Update" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const pickerStyles = {
  box: {
    background: "#f0f7ff",
    border: "1px solid #b7d4f0",
    borderRadius: 10,
    padding: "0.7rem 0.85rem",
    marginBottom: "0.9rem",
  },
  headerRow: { display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" },
  title: { fontWeight: 700, fontSize: "0.88rem", color: "#0d47a1" },
  hint: { fontSize: "0.74rem", color: "#5f6d7e" },
  chips: { display: "flex", flexWrap: "wrap", gap: "0.4rem" },
  chip: {
    fontFamily: "inherit",
    fontSize: "0.82rem",
    fontWeight: 600,
    padding: "0.35rem 0.85rem",
    borderRadius: 999,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
    boxShadow: "none",
    margin: 0,
  },
  chipOn: { background: "#0d47a1", color: "#fff", border: "1px solid #0d47a1" },
  chipOff: { background: "#fff", color: "#0d47a1", border: "1px solid #b7d4f0" },
};
