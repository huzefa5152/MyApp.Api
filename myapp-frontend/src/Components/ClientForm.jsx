import { useState, useEffect } from "react";
import { createClient, updateClient } from "../api/clientApi";
import { formStyles } from "../theme";

const {
  backdrop, modal, header, title, closeButton,
  body, error: errorStyle, formGroup, label, input,
  footer, button, cancel, submit,
} = formStyles;

export default function ClientForm({ client, companyId, onClose, onSaved }) {
  const [formData, setFormData] = useState(
    client || { id: null, name: "", address: "", email: "", phone: "" }
  );
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (client) setFormData(client);
  }, [client]);

  const validate = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Name is required";
    if (!formData.email.trim()) newErrors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email))
      newErrors.email = "Email is invalid";
    if (!formData.phone.trim()) newErrors.phone = "Phone is required";
    else if (!/^\+?\d{7,15}$/.test(formData.phone))
      newErrors.phone = "Phone number is invalid";
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
      const payload = { ...formData, companyId };
      let result;
      if (formData.id) result = await updateClient(formData.id, payload);
      else result = await createClient(payload);
      onSaved(result.data);
      onClose();
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to save client. Please try again.";
      alert(msg);
    }
  };

  const fieldError = (name) =>
    errors[name] ? { border: "1px solid #dc3545" } : {};

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
              {errors.name && <span style={{ color: "#dc3545", fontSize: "0.78rem", marginTop: "0.2rem", display: "block" }}>{errors.name}</span>}
            </div>

            <div style={formGroup}>
              <label style={label}>Address</label>
              <input type="text" name="address" value={formData.address} onChange={handleChange} style={input} />
            </div>

            <div style={formGroup}>
              <label style={label}>Email *</label>
              <input type="email" name="email" value={formData.email} onChange={handleChange} style={{ ...input, ...fieldError("email") }} />
              {errors.email && <span style={{ color: "#dc3545", fontSize: "0.78rem", marginTop: "0.2rem", display: "block" }}>{errors.email}</span>}
            </div>

            <div style={formGroup}>
              <label style={label}>Phone *</label>
              <input type="text" name="phone" value={formData.phone} onChange={handleChange} style={{ ...input, ...fieldError("phone") }} />
              {errors.phone && <span style={{ color: "#dc3545", fontSize: "0.78rem", marginTop: "0.2rem", display: "block" }}>{errors.phone}</span>}
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
