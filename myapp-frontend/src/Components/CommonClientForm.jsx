import { useEffect, useState } from "react";
import { MdClose, MdInfo, MdBusiness, MdCheckCircle, MdDelete } from "react-icons/md";
import { getCommonClientById, updateCommonClient, deleteCommonClient, deleteClient } from "../api/clientApi";
import { getFbrLookupsByCategory } from "../api/fbrLookupApi";
import { usePermissions } from "../contexts/PermissionsContext";
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
export default function CommonClientForm({ groupId, onClose, onSaved, onChange }) {
  const { has } = usePermissions();
  const canDelete = has("clients.manage.delete");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // While a per-member delete is in flight, this holds that member's
  // clientId so we can spin only the right row's button + lock all the
  // other actions (bulk delete / save / cancel) without ambiguity.
  const [deletingMemberId, setDeletingMemberId] = useState(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  // Province dropdown options — same FBR Lookup category the per-
  // company ClientForm uses, so the picker shape matches end-to-end.
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

  // Load FBR Province lookups once (independent of groupId — same list
  // for every common client).
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
          // Site pre-fills from whichever member has the longest list
          // (server-side pick), so opening the form on a tenant that
          // has no sites still shows the master list ready to save.
          site: data.site || "",
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

  // Same registration-type → identity-fields mapping as ClientForm.
  const regType = form.registrationType;
  const showNtn  = regType === "Registered" || regType === "FTN";
  const showStrn = regType === "Registered";
  const showCnic = regType === "Unregistered" || regType === "CNIC";
  const ntnLabel = regType === "FTN" ? "FTN" : "NTN";

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "registrationType") {
      // Drop stale identity values when switching type so they don't get
      // propagated unchanged to every sibling company on save.
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
    const hasInvoices = detail.members?.some((m) => m.hasInvoices);

    // Strong confirmation — this cascades across every tenant. Same
    // shape as the per-company delete (which also cascades hard) but
    // multiplied by N tenants in one click, so the prompt has to
    // make the blast radius obvious.
    const confirmation = window.confirm(
      `Delete "${detail.displayName}" from ${memberCount} compan${memberCount === 1 ? "y" : "ies"} ` +
        `(${companyList})?\n\n` +
        (hasInvoices
          ? "⚠️ At least one company has invoices for this client — those invoices and their delivery challans will ALSO be deleted.\n\n"
          : "") +
        "This cannot be undone."
    );
    if (!confirmation) return;

    setDeleting(true);
    setError("");
    try {
      const { data } = await deleteCommonClient(groupId);
      // onSaved doubles as the refresh hook — pass null so the
      // parent treats this as "form closed, refresh both lists".
      onSaved?.(data);
      onClose?.();
    } catch (e) {
      setError(e?.response?.data?.message || "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Per-member delete — removes ONLY this client from one company while
   * leaving the rest of the group intact. Different button, different
   * confirmation, different blast radius from the bulk "Delete from all
   * companies" action above.
   *
   * Edge cases handled:
   *   - Has invoices: confirmation amplifies the warning; backend cascade
   *     deletes the invoices + their delivery challans for that company.
   *   - Last surviving member: after this delete the group has 0 members,
   *     so the Common Clients panel filter (HAVING COUNT >= 2) silently
   *     drops it and the surviving company-side ClientsPage stops hiding
   *     it. We close the modal and bubble onSaved() so the parent
   *     refreshes both lists.
   *   - Members > 0 remain: refetch detail in place + bubble onChange()
   *     so the parent's lists refresh WITHOUT closing the modal — the
   *     operator can keep editing or remove from another company.
   *   - Tenant-access denied (403): the per-company delete endpoint
   *     enforces ICompanyAccessGuard, so the error message comes back
   *     verbatim and is shown in the modal's existing error banner.
   *   - Permission missing: the per-row button doesn't render at all.
   *   - Concurrent clicks: deletingMemberId locks every other action
   *     until this one finishes; the row's button shows "Removing…".
   *   - Refetch 404: treated as "group is gone" → close + onSaved.
   */
  const handleDeleteMember = async (member) => {
    if (!member || !detail || deletingMemberId || deleting || saving) return;

    const remainingCount = (detail.members?.length || 1) - 1;
    const confirmation = window.confirm(
      `Remove "${detail.displayName}" from ${member.companyName}?\n\n` +
        (remainingCount > 0
          ? `Other compan${remainingCount === 1 ? "y" : "ies"} (${remainingCount} remaining) will keep their copy of this client.\n\n`
          : `This is the last company holding this client — the Common Client will become a regular per-company client only.\n\n`) +
        (member.hasInvoices
          ? `⚠ ${member.companyName} has invoices for this client. Those invoices and their delivery challans will ALSO be deleted.\n\n`
          : "") +
        "This cannot be undone."
    );
    if (!confirmation) return;

    setDeletingMemberId(member.clientId);
    setError("");
    try {
      await deleteClient(member.clientId);

      // Tell the parent to refresh its per-company list + Common Clients
      // panel WITHOUT closing the modal — we stay open if there are still
      // members to manage.
      onChange?.();

      // Refetch the group detail so the row disappears + member count
      // updates. If the group is now empty (all rows removed), the API
      // either still returns it (with an empty members array) or 404s —
      // either way we close the modal and let the parent fully refresh.
      try {
        const { data } = await getCommonClientById(groupId);
        if (!data?.members?.length) {
          onSaved?.(null);
          onClose?.();
        } else {
          setDetail(data);
        }
      } catch (refreshErr) {
        // 404 means the group has no members left and was either dropped
        // by the service or filtered out. Treat the modal as done.
        if (refreshErr?.response?.status === 404) {
          onSaved?.(null);
          onClose?.();
        } else {
          // Other refresh failures: client IS deleted but we can't
          // refresh — surface a soft message and close so the user
          // doesn't see stale state.
          setError(
            refreshErr?.response?.data?.message ||
              `Removed from ${member.companyName}, but failed to refresh. Close and reopen to see the latest state.`
          );
        }
      }
    } catch (e) {
      setError(
        e?.response?.data?.message ||
          `Failed to remove from ${member.companyName}.`
      );
    } finally {
      setDeletingMemberId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    // Type-driven identity validation — same rules as ClientForm so the
    // common edit can't save a half-filled identity that would fail FBR
    // submission later.
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
                    Switching type clears values for hidden fields so a
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
                      Unregistered buyers don't have NTN/STRN — CNIC is the FBR identity for individuals.
                    </span>
                  </div>
                )}

                {/* FBR Province + Phone + Email on one row on desktop;
                    `form-grid-3col` collapses to 1 column on phones via
                    the responsive utility class in index.css. */}
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
                    company — pre-filled from the longest existing list across this client's
                    tenants, so editing once propagates the same sites everywhere.
                  </span>
                </div>

                {/* Member breakdown — lists every per-company copy of this
                    client. Each row supports an inline "remove from this
                    company" delete (gated on clients.manage.delete) so the
                    operator can decommission the client from one tenant
                    without touching the others. The bulk "Delete from all
                    companies" button at the modal footer handles the
                    "kill the legal entity" case. */}
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
                      {detail.members.map((m) => {
                        const removingThis = deletingMemberId === m.clientId;
                        const otherActionInFlight =
                          (deletingMemberId !== null && !removingThis) ||
                          deleting || saving;
                        return (
                          <div key={m.clientId} style={s.memberRow}>
                            <div style={s.memberCompany}>
                              <MdCheckCircle size={14} color="#28a745" /> {m.companyName}
                            </div>
                            <div style={s.memberSite}>{m.site || <em style={{ color: "#aab3bf" }}>(no sites)</em>}</div>
                            <div style={s.memberFlag}>
                              {m.hasInvoices ? "Has bills" : <span style={{ color: "#aab3bf" }}>—</span>}
                            </div>
                            {canDelete ? (
                              <button
                                type="button"
                                style={{
                                  ...s.memberDeleteBtn,
                                  opacity: removingThis || otherActionInFlight ? 0.55 : 1,
                                  cursor: removingThis || otherActionInFlight ? "not-allowed" : "pointer",
                                }}
                                onClick={() => handleDeleteMember(m)}
                                disabled={removingThis || otherActionInFlight}
                                title={`Remove this client from ${m.companyName} only`}
                                aria-label={`Remove from ${m.companyName}`}
                              >
                                <MdDelete size={14} />
                                <span style={s.memberDeleteText}>
                                  {removingThis ? "Removing…" : "Remove"}
                                </span>
                              </button>
                            ) : (
                              <span />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ ...formStyles.footer, justifyContent: "space-between" }}>
            {/* Delete on the left, Cancel/Save on the right — same
                pattern as native edit dialogs that have a destructive
                action. Hidden entirely without the permission so the
                button never tantalises operators who can't use it. */}
            {canDelete && detail ? (
              <button
                type="button"
                style={{ ...formStyles.button, ...s.deleteBtn }}
                onClick={handleDelete}
                disabled={deleting || saving || loading || deletingMemberId !== null}
                title="Delete this client from every company that has it"
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
                disabled={saving || deleting || deletingMemberId !== null}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ ...formStyles.button, ...formStyles.submit }}
                disabled={saving || deleting || loading || deletingMemberId !== null}
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
    // 4-column layout: company name, site list, has-bills flag,
    // per-row remove button. The auto-sized last column sits on the
    // far right; the company column's 1fr keeps name aligned and the
    // site column's 2fr soaks up the rest.
    gridTemplateColumns: "1fr 2fr auto auto",
    gap: "0.5rem",
    alignItems: "center",
    fontSize: "0.82rem",
    padding: "0.4rem 0.5rem",
    borderRadius: 6,
    background: "#fff",
    border: "1px solid #f0f3f7",
  },
  memberCompany: { display: "inline-flex", alignItems: "center", gap: "0.25rem", fontWeight: 600, color: "#1a2332", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  memberSite: { color: "#5f6d7e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  memberFlag: { color: "#5f6d7e", fontSize: "0.78rem", whiteSpace: "nowrap" },
  memberDeleteBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.3rem 0.55rem",
    borderRadius: 6,
    border: "1px solid rgba(220, 53, 69, 0.25)",
    background: "#fff0f1",
    color: "#dc3545",
    fontSize: "0.74rem",
    fontWeight: 600,
    transition: "background 150ms ease, border-color 150ms ease",
    whiteSpace: "nowrap",
  },
  memberDeleteText: {
    // Hide the "Remove" / "Removing…" text on tiny widths — the trash
    // icon alone communicates the action and the title attr remains
    // for accessibility.
    fontSize: "0.74rem",
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
};
