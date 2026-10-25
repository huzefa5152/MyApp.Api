import { useEffect, useState } from "react";
import { MdInfo, MdBusiness, MdCheckCircle, MdDelete, MdAdd, MdStorefront, MdVerifiedUser, MdPlace } from "react-icons/md";
import { getCommonSupplierById, updateCommonSupplier, deleteCommonSupplier, copySupplierToCompanies } from "../api/supplierApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { usePermissions } from "../contexts/PermissionsContext";
import { useCompany } from "../contexts/CompanyContext";
import { useConfirm } from "./ConfirmDialog";
import { formStyles, modalSizes } from "../theme";
import CopyToCompaniesDialog from "./CopyToCompaniesDialog";
import { notify } from "../utils/notify";
import useScrollToError from "../hooks/useScrollToError";
import { PartyFormHeader, FormSection } from "./party/PartyFormKit";

/**
 * Mirror of <see cref="CommonClientForm"/> for the purchase side.
 * Edit form for a "Common Supplier" group + its sibling Supplier
 * members across companies. Master fields propagate to every member
 * on save — including Site, because operators kept hitting the
 * "I added sites under one tenant and they didn't show up for the
 * other" papercut. Read-only member breakdown lets the operator
 * confirm the cascade target list before saving.
 */
export default function CommonSupplierForm({ groupId, onClose, onSaved, onChange }) {
  const { has } = usePermissions();
  const confirm = useConfirm();
  const { companies } = useCompany();
  const canDelete = has("suppliers.manage.delete");
  const canCopy = has("suppliers.manage.copy");
  const [addingToCompanies, setAddingToCompanies] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const errRef = useScrollToError(error);
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
    <div data-admin-backdrop="" style={formStyles.backdrop}>
      <div data-admin-dialog=""
        style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px`, cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
      >
        <PartyFormHeader
          title="Edit Common Supplier"
          subtitle={detail ? `Shared by ${detail.members?.length || 0} companies · changes apply to every one` : "Loading…"}
          name={form.name}
          onClose={onClose}
        />

        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div data-admin-body="" className="pf-body" style={{ ...formStyles.body, background: "#f5f8fc" }}>
            {loading ? (
              <div style={s.notice}>Loading…</div>
            ) : (
              <>
                {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

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

                <FormSection icon={<MdStorefront size={18} />} title="Business details" hint="As it should print on documents">
                <div data-admin-field="" style={formStyles.formGroup}>
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
                  <div data-admin-field="" style={formStyles.formGroup}>
                    <label style={formStyles.label}>Phone</label>
                    <input name="phone" value={form.phone} onChange={handleChange} style={formStyles.input} />
                  </div>
                  <div data-admin-field="" style={formStyles.formGroup}>
                    <label style={formStyles.label}>Email</label>
                    <input name="email" type="email" value={form.email} onChange={handleChange} style={formStyles.input} />
                  </div>
                </div>
                <div data-admin-field="" style={formStyles.formGroup}>
                  <label style={formStyles.label}>Address</label>
                  <input name="address" value={form.address} onChange={handleChange} style={formStyles.input} />
                </div>
                </FormSection>

                <FormSection tone="fbr" icon={<MdVerifiedUser size={18} />} title="FBR identity" hint="Checked by FBR on every invoice">
                {/* Registration type drives the identity fields below.
                    Switching type clears the now-irrelevant fields so a
                    stale NTN doesn't propagate to every member company. */}
                <div className="form-grid-2col">
                  <div data-admin-field="" style={formStyles.formGroup}>
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
                  <div data-admin-field="" style={formStyles.formGroup}>
                    <label style={formStyles.label}>Province</label>
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
                </div>

                {(showNtn || showStrn) && (
                  <div className="form-grid-2col">
                    {showNtn && (
                      <div data-admin-field="" style={formStyles.formGroup}>
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
                      <div data-admin-field="" style={formStyles.formGroup}>
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
                  <div data-admin-field="" style={formStyles.formGroup}>
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
                </FormSection>

                <FormSection icon={<MdPlace size={18} />} title="Sites" hint="Offered as choices on delivery challans">
                <div data-admin-field="" style={formStyles.formGroup}>
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
                </FormSection>

                {detail?.members?.length > 0 && (
                  <FormSection
                    icon={<MdBusiness size={18} />}
                    title={`Companies (${detail.members.length})`}
                    hint="Each company keeps its own copy of this supplier"
                    aside={canCopy && (() => {
                        const memberCompanyIds = new Set((detail.members || []).map((m) => m.companyId));
                        const remainingCount = companies.filter((c) => !memberCompanyIds.has(c.id)).length;
                        if (remainingCount === 0) return null;
                        return (
                          <button
                            type="button"
                            style={s.addCompanyBtn}
                            onClick={() => setAddingToCompanies(true)}
                            disabled={saving || deleting}
                            title="Add this common supplier to other companies that don't have it yet"
                          >
                            <MdAdd size={14} />
                            Add to {remainingCount === 1 ? "1 more company" : `${remainingCount} more companies`}
                          </button>
                        );
                      })()}
                  >
                    <div className="pf-members">
                      {detail.members.map((m) => (
                        <div key={m.supplierId} className="pf-member">
                          <div className="pf-member__company">
                            <MdCheckCircle size={14} color="#28a745" /> {m.companyName}
                          </div>
                          <div className="pf-member__site">{m.site || <em style={{ color: "#aab3bf" }}>(no sites)</em>}</div>
                          <div className="pf-member__flag">
                            {m.hasPurchaseBills ? "Has bills" : <span style={{ color: "#aab3bf" }}>—</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </FormSection>
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
              <button data-admin-close=""
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

      {addingToCompanies && detail && (
        <CopyToCompaniesDialog
          open={true}
          title="Add this supplier to more companies"
          subjectLabel={detail.displayName}
          companies={companies}
          excludeIds={(detail.members || []).map((m) => m.companyId)}
          onCancel={() => setAddingToCompanies(false)}
          onConfirm={async (companyIds) => {
            const sourceSupplierId = detail.members?.[0]?.supplierId;
            if (!sourceSupplierId) {
              throw new Error("This group has no source member to copy from.");
            }
            const { data } = await copySupplierToCompanies(sourceSupplierId, companyIds);
            const createdCount = data?.created?.length ?? 0;
            const skipped = data?.skippedReasons ?? [];
            if (createdCount > 0) {
              notify(
                `Added "${detail.displayName}" to ${createdCount} ${createdCount === 1 ? "company" : "companies"}` +
                (skipped.length > 0 ? ` (${skipped.length} skipped)` : "."),
                "success"
              );
            } else if (skipped.length > 0) {
              notify(`No copies made — ${skipped[0]}`, "warning");
            }
            setAddingToCompanies(false);
            try {
              const { data: fresh } = await getCommonSupplierById(groupId);
              setDetail(fresh);
            } catch { /* non-fatal */ }
            onChange?.();
          }}
        />
      )}
    </div>
  );
}

const s = {
  notice: { padding: "2rem", textAlign: "center", color: "#5f6d7e" },
  cascadeBanner: {
    display: "flex",
    gap: "0.6rem",
    background: "linear-gradient(135deg, rgba(13,71,161,0.07), rgba(0,137,123,0.08))",
    border: "1px solid #cfe0f4",
    color: "#0a3680",
    padding: "0.75rem 0.95rem",
    borderRadius: 14,
    marginBottom: "0.9rem",
  },
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
  addCompanyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    flexShrink: 0,
    minHeight: 36,
    padding: "0 0.75rem",
    margin: 0,
    borderRadius: 999,
    border: "1px solid #d8e3f1",
    background: "#f5f8fc",
    color: "#0d47a1",
    fontSize: "0.76rem",
    fontWeight: 700,
    boxShadow: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
