import { useEffect, useState } from "react";
import { MdClose, MdInfo, MdBusiness, MdCheckCircle, MdDelete } from "react-icons/md";
import { getCommonSupplierById, updateCommonSupplier, deleteCommonSupplier } from "../api/supplierApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "./ConfirmDialog";
import { formStyles, modalSizes } from "../theme";

/**
 * Mirror of <see cref="CommonClientForm"/> for the purchase side.
 * Edit form for a "Common Supplier" group + its sibling Supplier
 * members across companies. Master fields propagate to every member
 * on save — including Site, because operators kept hitting the
 * "I added sites under one tenant and they didn't show up for the
 * other" papercut. Read-only member breakdown lets the operator
 * confirm the cascade target list before saving.
 */
export default function CommonSupplierForm({ groupId, onClose, onSaved }) {
  const { has } = usePermissions();
  const confirm = useConfirm();
  const canDelete = has("suppliers.manage.delete");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [provinces, setProvinces] = useState([]);
  const [form, setForm] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    ntn: "",
    strn: "",
    cnic: "",
    site: "",
    registrationType: "",
    fbrProvinceCode: null,
  });

  // Province dropdown options (loaded once).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getFbrLookupsByCategory("Province");
        if (!cancelled) setProvinces(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setProvinces([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await getCommonSupplierById(groupId);
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
          site: data.site || "",
          registrationType: data.registrationType || "",
          fbrProvinceCode: data.fbrProvinceCode ?? null,
        });
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || "Failed to load common supplier.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  // Same registration-type → identity-fields mapping as ClientForm.
  const regType = form.registrationType;
  const showNtn  = regType === "Registered" || regType === "FTN";
  const showStrn = regType === "Registered";
  const showCnic = regType === "Unregistered" || regType === "CNIC";
  const ntnLabel = regType === "FTN" ? "FTN" : "NTN";

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "registrationType") {
      setForm((f) => ({
        ...f,
        registrationType: value,
        ntn:  (value === "Registered" || value === "FTN") ? f.ntn  : "",
        strn: (value === "Registered")                    ? f.strn : "",
        cnic: (value === "Unregistered" || value === "CNIC") ? f.cnic : "",
      }));
      return;
    }
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleDelete = async () => {
    if (!detail || deleting) return;
    const memberCount = detail.members?.length || 0;
    const companyList = detail.members?.map((m) => m.companyName).join(", ") || "this company";
    const hasBills = detail.members?.some((m) => m.hasPurchaseBills);

    // Strong confirmation — same shape as the per-tenant delete UX
    // multiplied by N tenants.
    const confirmation = await confirm({
      title: `Delete from all ${memberCount} compan${memberCount === 1 ? "y" : "ies"}?`,
      message:
        `"${detail.displayName}" will be removed from ${companyList}.\n\n` +
        (hasBills
          ? "⚠ At least one company has purchase bills against this supplier — the per-tenant SupplierService.DeleteAsync will refuse to delete those rows. Remove the bills first.\n\n"
          : "") +
        "This cannot be undone.",
      variant: "danger",
      confirmText: "Delete from all",
    });
    if (!confirmation) return;

    setDeleting(true);
    setError("");
    try {
      const { data } = await deleteCommonSupplier(groupId);
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (showNtn && !form.ntn?.trim()) {
      setError(`${ntnLabel} is required for ${regType} entities.`);
      return;
    }
    if (showStrn && !form.strn?.trim()) {
      setError("STRN is required for Registered entities.");
      return;
    }
    if (showCnic) {
      const digits = (form.cnic || "").replace(/\D/g, "");
      if (!digits) { setError("CNIC is required for this registration type."); return; }
      if (digits.length !== 13) { setError("CNIC must be 13 digits."); return; }
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address?.trim() || null,
        phone: form.phone?.trim() || null,
        email: form.email?.trim() || null,
        ntn: showNtn ? (form.ntn?.trim() || null) : null,
        strn: showStrn ? (form.strn?.trim() || null) : null,
        cnic: showCnic ? (form.cnic?.trim() || null) : null,
        site: form.site?.trim() || null,
        registrationType: form.registrationType?.trim() || null,
        fbrProvinceCode: form.fbrProvinceCode ?? null,
      };
      const { data } = await updateCommonSupplier(groupId, payload);
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
          <h5 style={formStyles.title}>Edit Common Supplier</h5>
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

                {detail && (
                  <div style={s.cascadeBanner}>
                    <MdInfo size={18} color="#0d47a1" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>
                        Changes propagate to {detail.members?.length || 0} supplier
                        {(detail.members?.length || 0) !== 1 ? "s" : ""} across {memberCompanyList || "this company"}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#5f6d7e" }}>
                        Every field below — including <strong>Sites</strong> — applies to every sibling
                        company's record on save. Sites pre-fill from the longest existing list so the
                        common case (you set them under one tenant, forgot the others) is a no-op rewrite.
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

                {/* Registration type drives the identity fields below.
                    Switching type clears the now-irrelevant fields so a
                    stale NTN doesn't propagate to every member company. */}
                <div className="form-grid-2col">
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
                      <option value="FTN">FTN</option>
                      <option value="CNIC">CNIC</option>
                    </select>
                  </div>
                </div>

                {(showNtn || showStrn) && (
                  <div className="form-grid-2col">
                    {showNtn && (
                      <div style={formStyles.formGroup}>
                        <label style={formStyles.label}>{ntnLabel} *</label>
                        <input
                          name="ntn"
                          value={form.ntn}
                          onChange={handleChange}
                          style={formStyles.input}
                          placeholder={regType === "FTN" ? "Federal Tax Number" : "7-digit NTN"}
                        />
                      </div>
                    )}
                    {showStrn && (
                      <div style={formStyles.formGroup}>
                        <label style={formStyles.label}>STRN *</label>
                        <input
                          name="strn"
                          value={form.strn}
                          onChange={handleChange}
                          style={formStyles.input}
                          placeholder="13-digit Sales Tax Registration Number"
                        />
                      </div>
                    )}
                  </div>
                )}

                {showCnic && (
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>CNIC (13 digits) *</label>
                    <input
                      name="cnic"
                      value={form.cnic}
                      onChange={handleChange}
                      style={formStyles.input}
                      placeholder="3520112345678"
                      maxLength={13}
                    />
                    <span style={s.fieldHelp}>
                      Unregistered vendors don't have NTN/STRN — CNIC is the FBR identity for individuals.
                    </span>
                  </div>
                )}

                <div className="form-grid-3col">
                  <div style={formStyles.formGroup}>
                    <label style={formStyles.label}>FBR Province</label>
                    <select
                      name="fbrProvinceCode"
                      value={form.fbrProvinceCode ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          fbrProvinceCode: e.target.value === "" ? null : Number(e.target.value),
                        }))
                      }
                      style={formStyles.input}
                    >
                      <option value="">— Select province —</option>
                      {provinces.map((p) => (
                        <option key={p.id} value={p.code}>{p.label}</option>
                      ))}
                    </select>
                  </div>
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

                <div style={formStyles.formGroup}>
                  <label style={formStyles.label}>Sites</label>
                  <input
                    name="site"
                    value={form.site}
                    onChange={handleChange}
                    style={formStyles.input}
                    placeholder="e.g. Site-A ; Site-B ; Site-C"
                  />
                  <span style={s.fieldHelp}>
                    Semicolon-separated. Saving here overwrites the site list on every member
                    company — pre-filled from the longest existing list across this supplier's
                    tenants, so editing once propagates the same sites everywhere.
                  </span>
                </div>

                {detail?.members?.length > 0 && (
                  <div style={s.membersBlock}>
                    <div style={s.membersHeader}>
                      <MdBusiness size={16} color="#0d47a1" />
                      <span style={{ fontWeight: 700 }}>Per-company members</span>
                    </div>
                    <div style={s.membersTable}>
                      {detail.members.map((m) => (
                        <div key={m.supplierId} style={s.memberRow}>
                          <div style={s.memberCompany}>
                            <MdCheckCircle size={14} color="#28a745" /> {m.companyName}
                          </div>
                          <div style={s.memberSite}>{m.site || <em style={{ color: "#aab3bf" }}>(no sites)</em>}</div>
                          <div style={s.memberFlag}>
                            {m.hasPurchaseBills ? "Has bills" : <span style={{ color: "#aab3bf" }}>—</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ ...formStyles.footer, justifyContent: "space-between" }}>
            {canDelete && detail ? (
              <button
                type="button"
                style={{ ...formStyles.button, ...s.deleteBtn }}
                onClick={handleDelete}
                disabled={deleting || saving || loading}
                title="Delete this supplier from every company that has it"
              >
                <MdDelete size={16} style={{ verticalAlign: "-3px", marginRight: 4 }} />
                {deleting ? "Deleting…" : "Delete from all companies"}
              </button>
            ) : <span />}

            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button
                type="button"
                style={{ ...formStyles.button, ...formStyles.cancel }}
                onClick={onClose}
                disabled={saving || deleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ ...formStyles.button, ...formStyles.submit }}
                disabled={saving || deleting || loading}
              >
                {saving ? "Saving…" : "Save & propagate"}
              </button>
            </div>
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
  fieldHelp: {
    fontSize: "0.75rem",
    color: "#5f6d7e",
    marginTop: "0.25rem",
    display: "block",
    lineHeight: 1.4,
  },
  deleteBtn: {
    background: "#fff0f1",
    backgroundColor: "#fff0f1",
    color: "#dc3545",
    border: "1px solid rgba(220,53,69,0.2)",
    boxShadow: "none",
  },
};
