import { useState, useRef, useEffect } from "react";
import { createClient, updateClient } from "../api/clientApi"; // axios calls
import "bootstrap/dist/css/bootstrap.min.css";

export default function ClientForm({ client, onClose, onSaved }) {
  const [formData, setFormData] = useState(
    client || { id: null, name: "", address: "", email: "", phone: "" }
  );
  const [errors, setErrors] = useState({});
  const modalRef = useRef(null);
  const headerRef = useRef(null);

  // ------------------ Draggable modal ------------------
  useEffect(() => {
    const modal = modalRef.current;
    const header = headerRef.current;
    if (!modal || !header) return;

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onMouseDown = (e) => {
      isDragging = true;
      offsetX = e.clientX - modal.offsetLeft;
      offsetY = e.clientY - modal.offsetTop;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      modal.style.left = `${e.clientX - offsetX}px`;
      modal.style.top = `${e.clientY - offsetY}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    header.addEventListener("mousedown", onMouseDown);
    return () => header.removeEventListener("mousedown", onMouseDown);
  }, []);

  // ------------------ Validation ------------------
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

  // ------------------ Handlers ------------------
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      const payload = { ...formData };
      let result;
      if (formData.id) result = await updateClient(formData.id, payload);
      else result = await createClient(payload);

      onSaved(result.data);
      onClose();
    } catch (err) {
      const msg =
        err.response?.data?.message || "Failed to save client. Please try again.";
      alert(msg);
    }
  };

  return (
    <div className="modal fade show d-block" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div
        ref={modalRef}
        className="modal-dialog modal-dialog-scrollable"
        style={{
          position: "absolute",
          top: "100px",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        <div className="modal-content">
          <div
            ref={headerRef}
            className="modal-header bg-primary text-white"
            style={{ cursor: "move" }}
          >
            <h5 className="modal-title">{client ? "Edit Client" : "Add Client"}</h5>
            <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <div className="modal-body">
              {/* Name */}
              <div className="mb-3">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`form-control ${errors.name ? "is-invalid" : ""}`}
                />
                {errors.name && <div className="invalid-feedback">{errors.name}</div>}
              </div>

              {/* Address */}
              <div className="mb-3">
                <label className="form-label">Address</label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className="form-control"
                />
              </div>

              {/* Email */}
              <div className="mb-3">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className={`form-control ${errors.email ? "is-invalid" : ""}`}
                />
                {errors.email && <div className="invalid-feedback">{errors.email}</div>}
              </div>

              {/* Phone */}
              <div className="mb-3">
                <label className="form-label">Phone</label>
                <input
                  type="text"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className={`form-control ${errors.phone ? "is-invalid" : ""}`}
                />
                {errors.phone && <div className="invalid-feedback">{errors.phone}</div>}
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
