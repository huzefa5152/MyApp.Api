import { useState, useEffect } from "react";
import { createSupplier, updateSupplier } from "../api/supplierApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { notify } from "../utils/notify";
import { formStyles } from "../theme";

const {
  backdrop, modal, header, title, closeButton,
  body, error: errorStyle, formGroup, label, input,
  footer, button, cancel, submit,
} = formStyles;

export default function SupplierForm({ supplier, companyId, onClose, onSaved }) {
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

  const validate = () => {
    const next = {};
    if (!formData.name.trim()) next.name = "Name is required";
    // NTN/STRN are encouraged but not strictly required for suppliers —
    // some small vendors only have CNIC. We surface a soft prompt rather
    // than block save. Registration type still drives the CNIC ask below.
    if ((formData.registrationType === "Unregistered" || formData.registrationType === "CNIC") && !formData.cnic.trim()) {
      next.cnic = "CNIC is required for this registration type";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const payload = {
        ...formData,
        companyId,
        fbrProvinceCode: formData.fbrProvinceCode === "" ? null : Number(formData.fbrProvinceCode),
        registrationType: formData.registrationType || null,
        cnic: formData.cnic || null,
      };
      const result = formData.id
        ? await updateSupplier(formData.id, payload)
        : await createSupplier(payload);
      onSaved(result.data);
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={formGroup}>
                <label style={label}>NTN</label>
                <input type="text" name="ntn" value={formData.ntn} onChange={handleChange} style={input} />
              </div>
              <div style={formGroup}>
                <label style={label}>STRN</label>
                <input type="text" name="strn" value={formData.strn} onChange={handleChange} style={input} />
              </div>
            </div>

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
              {(formData.registrationType === "Unregistered" || formData.registrationType === "CNIC") && (
                <div style={formGroup}>
                  <label style={label}>CNIC (13 digits) *</label>
                  <input type="text" name="cnic" value={formData.cnic} onChange={handleChange} style={{ ...input, ...fieldError("cnic") }} placeholder="3520112345678" maxLength={13} />
                  {errorMsg("cnic")}
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
