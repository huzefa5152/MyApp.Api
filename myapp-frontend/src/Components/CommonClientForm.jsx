import { useEffect, useState } from "react";
import { MdClose, MdInfo, MdBusiness, MdCheckCircle } from "react-icons/md";
import { getCommonClientById, updateCommonClient } from "../api/clientApi";
import { formStyles, modalSizes } from "../theme";

/**
 * Edit form for a "Common Client" (a ClientGroup row + its sibling
 * Client members across companies). Master fields entered here are
 * propagated to EVERY member when the operator saves — `Site` is
 * intentionally excluded because each tenant manages its own
 * physical-department list.
 *
 * Read-only member breakdown shows which companies hold this client
 * and what site list each one carries — operator can confirm the
 * propagation will land on the rows they expect before saving.
 */
export default function CommonClientForm({ groupId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    ntn: "",
    strn: "",
    cnic: "",
    registrationType: "",
    fbrProvinceCode: null,
  });

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await getCommonClientById(groupId);
        if (cancelled) return;
        setDetail(data);
        setForm({
          name: data.displayName || "",
          address: data.address || "",
          phone: data.phone || "",
          email: data.email || "",
          ntn: data.ntn || "",
          strn: data.strn || "",
          cnic: data.cnic || "",
          registrationType: data.registrationType || "",
          fbrProvinceCode: data.fbrProvinceCode ?? null,
        });
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || "Failed to load common client.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address?.trim() || null,
        phone: form.phone?.trim() || null,
        email: form.email?.trim() || null,
        ntn: form.ntn?.trim() || null,
        strn: form.strn?.trim() || null,
        cnic: form.cnic?.trim() || null,
        registrationType: form.registrationType?.trim() || null,
        fbrProvinceCode: form.fbrProvinceCode ?? null,
      };
      const { data } = await updateCommonClient(groupId, payload);
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const memberCompanyList = detail?.members?.map((m) => m.companyName).join(", ") || "";

  return (
    <div style={formStyles.backdrop}>
      <div
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Edit Common Client</h5>
          <button
            type="button"
            style={formStyles.closeButton}
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <MdClose size={20} color="#fff" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div style={formStyles.body}>
            {loading ? (
              <div style={s.notice}>Loading…</div>
            ) : (
              <>
                {error && <div style={formStyles.error}>{error}</div>}

                {/* Cascade summary banner — sets expectations BEFORE the
                    operator saves: every change here applies to every
                    member company below. */}
                {detail && (
                  <div style={s.cascadeBanner}>
                    <MdInfo size={18} color="#0d47a1" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>
                        Changes propagate to {detail.members?.length || 0} client
                        {(detail.members?.length || 0) !== 1 ? "s" : ""} across {memberCompanyList || "this company"}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#5f6d7e" }}>
                        Master fields below (name, NTN, STRN, CNIC, registration type, address) are
                        applied to every sibling. Each company's <strong>Sites</strong> are unchanged —
                        edit those from the per-company client form.
                      </div>
                    </div>
                  </div>
                )}

                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Name *</label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    style={formStyles.input}
                    required
                  />
                </div>

                <div className="form-grid-2col">
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>NTN</label>
                    <input name="ntn" value={form.ntn} onChange={handleChange} style={formStyles.input} />
                  </div>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>STRN</label>
                    <input name="strn" value={form.strn} onChange={handleChange} style={formStyles.input} />
                  </div>
                </div>

                <div className="form-grid-2col">
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>CNIC</label>
                    <input name="cnic" value={form.cnic} onChange={handleChange} style={formStyles.input} />
                  </div>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Registration Type</label>
                    <select
                      name="registrationType"
                      value={form.registrationType}
                      onChange={handleChange}
                      style={formStyles.input}
                    >
                      <option value="">—</option>
                      <option value="Registered">Registered</option>
                      <option value="Unregistered">Unregistered</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid-2col">
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Phone</label>
                    <input name="phone" value={form.phone} onChange={handleChange} style={formStyles.input} />
                  </div>
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>Email</label>
                    <input name="email" type="email" value={form.email} onChange={handleChange} style={formStyles.input} />
                  </div>
                </div>

                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Address</label>
                  <input name="address" value={form.address} onChange={handleChange} style={formStyles.input} />
                </div>

                {/* Member breakdown — read-only, lets the operator
                    sanity-check that propagation lands on the rows they
                    expect (and see per-company sites that WON'T change). */}
                {detail?.members?.length > 0 && (
                  <div style={s.membersBlock}>
                    <div style={s.membersHeader}>
                      <MdBusiness size={16} color="#0d47a1" />
                      <span style={{ fontWeight: 700 }}>Per-company members</span>
                      <span style={{ color: "#5f6d7e", fontSize: "0.78rem" }}>
                        Sites stay per-company — edit each from the per-company form
                      </span>
                    </div>
                    <div style={s.membersTable}>
                      {detail.members.map((m) => (
                        <div key={m.clientId} style={s.memberRow}>
                          <div style={s.memberCompany}>
                            <MdCheckCircle size={14} color="#28a745" /> {m.companyName}
                          </div>
                          <div style={s.memberSite}>{m.site || <em style={{ color: "#aab3bf" }}>(no sites)</em>}</div>
                          <div style={s.memberFlag}>
                            {m.hasInvoices ? "Has bills" : <span style={{ color: "#aab3bf" }}>—</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div style={formStyles.footer}>
            <button
              type="button"
              style={{ ...formStyles.button, ...formStyles.cancel }}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...formStyles.button, ...formStyles.submit }}
              disabled={saving || loading}
            >
              {saving ? "Saving…" : "Save & propagate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const s = {
  notice: { padding: "2rem", textAlign: "center", color: "#5f6d7e" },
  cascadeBanner: {
    display: "flex",
    gap: "0.6rem",
    background: "#eef4fb",
    border: "1px solid #b7d4f0",
    color: "#0d47a1",
    padding: "0.7rem 0.9rem",
    borderRadius: 8,
    marginBottom: "1rem",
  },
  membersBlock: {
    marginTop: "1rem",
    background: "#f8fafc",
    border: "1px solid #e8edf3",
    borderRadius: 10,
    padding: "0.65rem 0.85rem",
  },
  membersHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.85rem",
    color: "#1a2332",
    marginBottom: "0.5rem",
    flexWrap: "wrap",
  },
  membersTable: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  memberRow: {
    display: "grid",
    gridTemplateColumns: "1fr 2fr auto",
    gap: "0.5rem",
    fontSize: "0.82rem",
    padding: "0.35rem 0.4rem",
    borderRadius: 6,
    background: "#fff",
    border: "1px solid #f0f3f7",
  },
  memberCompany: { display: "inline-flex", alignItems: "center", gap: "0.25rem", fontWeight: 600, color: "#1a2332" },
  memberSite: { color: "#5f6d7e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  memberFlag: { color: "#5f6d7e", fontSize: "0.78rem" },
};
