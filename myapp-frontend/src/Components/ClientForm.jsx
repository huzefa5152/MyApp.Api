import { useState, useEffect } from "react";
import { createClient, updateClient } from "../api/clientApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { notify } from "../utils/notify";
import { formStyles } from "../theme";

const {
  backdrop, modal, header, title, closeButton,
  body, error: errorStyle, formGroup, label, input,
  footer, button, cancel, submit,
} = formStyles;

export default function ClientForm({ client, companyId, onClose, onSaved }) {
  const [formData, setFormData] = useState(
    client
      ? { ...client, ntn: client.ntn || "", strn: client.strn || "", site: client.site || "", registrationType: client.registrationType || "", cnic: client.cnic || "", fbrProvinceCode: client.fbrProvinceCode ?? "" }
      : { id: null, name: "", address: "", email: "", phone: "", ntn: "", strn: "", site: "", registrationType: "", cnic: "", fbrProvinceCode: "" }
  );
  const [errors, setErrors] = useState({});
  const [provinces, setProvinces] = useState([]);
  const [regTypes, setRegTypes] = useState([]);

  useEffect(() => {
    if (client) setFormData({ ...client, ntn: client.ntn || "", strn: client.strn || "", site: client.site || "", registrationType: client.registrationType || "", cnic: client.cnic || "", fbrProvinceCode: client.fbrProvinceCode ?? "" });
  }, [client]);

  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [provRes, regRes] = await Promise.all([
          getFbrLookupsByCategory("Province"),
          getFbrLookupsByCategory("RegistrationType"),
        ]);
        setProvinces(provRes.data);
        setRegTypes(regRes.data);
      } catch { /* ignore — fallback to empty */ }
    };
    loadLookups();
  }, []);

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (!formData.ntn.trim()) newErrors.ntn = "NTN is required";
    if (!formData.strn.trim()) newErrors.strn = "STRN is required";
    if (!formData.registrationType) newErrors.registrationType = "Registration Type is required";
    if (!formData.fbrProvinceCode && formData.fbrProvinceCode !== 0) newErrors.fbrProvinceCode = "Province is required";
    if ((formData.registrationType === "Unregistered" || formData.registrationType === "CNIC") && !formData.cnic.trim()) {
      newErrors.cnic = "CNIC is required for this registration type";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const payload = { ...formData, companyId, fbrProvinceCode: formData.fbrProvinceCode === "" ? null : Number(formData.fbrProvinceCode), registrationType: formData.registrationType || null, cnic: formData.cnic || null };
      let result;
      if (formData.id) result = await updateClient(formData.id, payload);
      else result = await createClient(payload);
      onSaved(result.data);
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to save client. Please try again.";
      notify(msg, "error");
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
          <h5 style={title}>{client ? "Edit Client" : "New Client"}</h5>
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

            <div className="form-grid-2col">
              <div style={formGroup}>
                <label style={label}>Email</label>
                <input type="email" name="email" value={formData.email} onChange={handleChange} style={input} />
              </div>
              <div style={formGroup}>
                <label style={label}>Phone</label>
                <input type="text" name="phone" value={formData.phone} onChange={handleChange} style={input} />
              </div>
            </div>

            <div className="form-grid-2col">
              <div style={formGroup}>
                <label style={label}>NTN *</label>
                <input type="text" name="ntn" value={formData.ntn} onChange={handleChange} style={{ ...input, ...fieldError("ntn") }} />
                {errorMsg("ntn")}
              </div>
              <div style={formGroup}>
                <label style={label}>STRN *</label>
                <input type="text" name="strn" value={formData.strn} onChange={handleChange} style={{ ...input, ...fieldError("strn") }} />
                {errorMsg("strn")}
              </div>
            </div>

            <div style={formGroup}>
              <label style={label}>Sites</label>
              <input type="text" name="site" value={formData.site} onChange={handleChange} style={input} placeholder="e.g. Site-A ; Site-B ; Site-C" />
              <span style={{ fontSize: "0.75rem", color: "#5f6d7e", marginTop: "0.25rem", display: "block" }}>Separate multiple sites with semicolons (;). These will appear as dropdown options when creating a delivery challan.</span>
            </div>

            <div style={{ marginTop: "0.5rem", padding: "0.75rem", borderRadius: 10, border: "1px solid #0d47a130", backgroundColor: "#e3f2fd" }}>
              <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.85rem", color: "#0d47a1" }}>FBR Details</p>
              <div className="form-grid-2col">
                <div style={formGroup}>
                  <label style={label}>Registration Type *</label>
                  <select name="registrationType" value={formData.registrationType} onChange={handleChange} style={{ ...input, ...fieldError("registrationType") }}>
                    <option value="">Select...</option>
                    {regTypes.map((rt) => (
                      <option key={rt.id} value={rt.code}>{rt.label}</option>
                    ))}
                  </select>
                  {errorMsg("registrationType")}
                </div>
                <div style={formGroup}>
                  <label style={label}>Province *</label>
                  <select name="fbrProvinceCode" value={formData.fbrProvinceCode} onChange={handleChange} style={{ ...input, ...fieldError("fbrProvinceCode") }}>
                    <option value="">Select...</option>
                    {provinces.map((p) => (
                      <option key={p.id} value={p.code}>{p.label}</option>
                    ))}
                  </select>
                  {errorMsg("fbrProvinceCode")}
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
            <button type="submit" style={{ ...button, ...submit }}>{client ? "Update" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
