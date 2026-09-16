import { useState, useEffect, useCallback } from "react";
import {
  MdPublic, MdAdd, MdContentCopy, MdCheck, MdDelete, MdBusiness, MdWarning,
  MdOpenInNew, MdToggleOn, MdToggleOff,
} from "react-icons/md";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { colors, formStyles, modalSizes, dropdownStyles } from "../theme";
import useIsNarrow from "../hooks/useIsNarrow";
import useScrollToError from "../hooks/useScrollToError";
import SearchableSelect from "../Components/SearchableSelect";
import { getClientsByCompany } from "../api/clientApi";
import {
  getCustomerPortals, getPortalDocumentOptions, createCustomerPortal,
  setPortalDocumentType, setPortalActive, deleteCustomerPortal,
} from "../api/customerPortalApi";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * Configuration → Customer Portals. Issue, disable and revoke the public links
 * that let a customer see their own invoices without an account.
 *
 * Every row on this page carries a LIVE BEARER TOKEN in its URL. The link is
 * shown behind a Copy button rather than printed in full, and the page says
 * plainly what handing it over means — an operator who does not know the link
 * IS the password will paste it into a group chat.
 */
export default function CustomerPortalsPage() {
  const { companies, selectedCompany } = useCompany();
  const { has } = usePermissions();
  const confirm = useConfirm();
  const isNarrow = useIsNarrow(860);

  const canView = has("customerportals.manage.view");
  const canCreate = has("customerportals.manage.create");
  const canUpdate = has("customerportals.manage.update");
  const canDelete = has("customerportals.manage.delete");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getCustomerPortals();
      setRows(data || []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (canView) load(); }, [canView, load]);

  const copyLink = async (p) => {
    try {
      await navigator.clipboard.writeText(p.publicUrl);
      setCopiedId(p.id);
      setTimeout(() => setCopiedId((c) => (c === p.id ? null : c)), 2000);
    } catch {
      // Clipboard access needs a secure context and a user gesture; when it is
      // unavailable, say so rather than silently doing nothing.
      notify("Couldn't copy automatically — open the link and copy it from the address bar.", "warning");
    }
  };

  const toggle = async (p) => {
    const turningOff = p.isActive;
    if (turningOff) {
      const ok = await confirm({
        title: "Disable this portal?",
        message: `${p.clientName} will lose access immediately. The same link starts working again if you re-enable it, so there is nothing to re-send.`,
        confirmText: "Disable",
      });
      if (!ok) return;
    }
    try {
      await setPortalActive(p.id, !p.isActive);
      notify(turningOff ? "Portal disabled." : "Portal enabled.", "success");
      load();
    } catch (err) {
      notify(err.response?.data?.error || "Could not change the portal.", "error");
    }
  };

  const revoke = async (p) => {
    const ok = await confirm({
      title: "Revoke this portal for good?",
      message: `${p.clientName}'s link stops working permanently and cannot be restored. If you only want to pause access, disable it instead.`,
      variant: "danger",
      confirmText: "Revoke",
    });
    if (!ok) return;
    try {
      await deleteCustomerPortal(p.id);
      notify("Portal revoked.", "success");
      load();
    } catch (err) {
      notify(err.response?.data?.error || "Could not revoke the portal.", "error");
    }
  };

  const changeDocument = async (p, documentType) => {
    try {
      await setPortalDocumentType(p.id, documentType || null);
      notify("Document updated.", "success");
      load();
    } catch (err) {
      notify(err.response?.data?.error || "Could not change the document.", "error");
    }
  };

  if (!canView) {
    return (
      <div style={{ padding: "2rem", color: colors.textSecondary }}>
        You don't have permission to view customer portals.
      </div>
    );
  }

  return (
    <div style={{ padding: "clamp(0.75rem, 2vw, 1.5rem)" }}>
      <div style={st.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <MdPublic size={26} color={colors.blue} />
          <h2 style={st.h2}>Customer Portals</h2>
          <span style={st.countChip}>{rows.length} link{rows.length === 1 ? "" : "s"}</span>
        </div>
        {canCreate && (
          <button style={st.primaryBtn} onClick={() => setShowForm(true)}>
            <MdAdd size={16} /> New Portal
          </button>
        )}
      </div>

      {/* Said once, plainly, at the top. An operator who thinks of this as "a
          link to the customer's page" will forward it without thinking. */}
      <div style={st.notice}>
        <MdWarning size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
        A portal link is a password. Anyone who has it can see that customer's invoices
        without logging in — so send it to the customer directly, and revoke it if it
        goes anywhere else.
      </div>

      {loading ? (
        <div style={st.empty}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={st.empty}>
          No portals yet. Issue one to let a customer see their own invoices without an account.
        </div>
      ) : (
        <div style={st.list}>
          {rows.map((p) => (
            <div key={p.id} style={{ ...st.card, ...(p.isActive ? null : st.cardOff) }}>
              <div style={st.cardHead}>
                <span style={st.client}>{p.clientName}</span>
                <span style={p.isActive ? st.activeChip : st.offChip}>
                  {p.isActive ? "active" : `disabled ${fmtDate(p.disabledAt)}`}
                </span>
                {!p.templateAvailable && (
                  <span style={st.warnChip} title="This company has no template for the chosen document">
                    <MdWarning size={11} style={{ verticalAlign: "-1px" }} /> no template
                  </span>
                )}
              </div>
              <div style={st.meta}>
                {p.companyName} · issued {fmtDate(p.createdAt)}
              </div>

              <div style={st.linkRow}>
                {/* The URL is shown truncated with the token hidden: the point
                    of the row is to COPY it, not to read a secret aloud. */}
                <span style={st.linkText} title="Copy the link rather than reading it out">
                  {p.publicUrl.replace(/\/portal\/.*$/, "/portal/") }
                  <span style={st.tokenMask}>••••••••</span>
                </span>
                <button style={st.linkBtn} onClick={() => copyLink(p)} aria-label={`Copy ${p.clientName}'s link`}>
                  {copiedId === p.id ? <><MdCheck size={15} /> Copied</> : <><MdContentCopy size={15} /> Copy link</>}
                </button>
                <a href={p.publicUrl} target="_blank" rel="noopener noreferrer"
                   style={st.linkBtn} aria-label={`Open ${p.clientName}'s portal`}>
                  <MdOpenInNew size={15} /> Open
                </a>
              </div>

              <div style={st.cardActions}>
                {canUpdate && (
                  <label style={st.docLabel}>
                    Document
                    <select
                      style={{ ...dropdownStyles.base, minWidth: 150 }}
                      value={p.documentType || ""}
                      onChange={(e) => changeDocument(p, e.target.value)}
                    >
                      <option value="">Automatic</option>
                      {p.availableDocumentTypes.includes("Bill") && <option value="Bill">Bill</option>}
                      {p.availableDocumentTypes.includes("TaxInvoice") && <option value="TaxInvoice">Tax Invoice</option>}
                    </select>
                  </label>
                )}
                <span style={{ flex: 1 }} />
                {canUpdate && (
                  <button style={st.rowBtn} onClick={() => toggle(p)}>
                    {p.isActive ? <><MdToggleOff size={17} /> Disable</> : <><MdToggleOn size={17} /> Enable</>}
                  </button>
                )}
                {canDelete && (
                  <button style={{ ...st.rowBtn, ...st.rowBtnDanger }} onClick={() => revoke(p)}>
                    <MdDelete size={15} /> Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <PortalForm
          companies={companies}
          defaultCompanyId={selectedCompany?.id}
          isNarrow={isNarrow}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Issue a portal ──
function PortalForm({ companies, defaultCompanyId, isNarrow, onClose, onSaved }) {
  const [companyId, setCompanyId] = useState(defaultCompanyId || companies[0]?.id || "");
  const [clientId, setClientId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [clients, setClients] = useState([]);
  const [options, setOptions] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const errRef = useScrollToError(error);

  useEffect(() => {
    if (!companyId) { setClients([]); setOptions([]); return; }
    let cancelled = false;
    // Scoped to the company on the SERVER — the picker must never be able to
    // offer a client the portal could not legally be issued for.
    getClientsByCompany(companyId)
      .then(({ data }) => { if (!cancelled) setClients(data || []); })
      .catch(() => { if (!cancelled) setClients([]); });
    getPortalDocumentOptions(companyId)
      .then(({ data }) => { if (!cancelled) setOptions(data || []); })
      .catch(() => { if (!cancelled) setOptions([]); });
    setClientId("");
    return () => { cancelled = true; };
  }, [companyId]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!companyId || !clientId) { setError("Pick a company and a customer."); return; }
    setSaving(true); setError("");
    try {
      await createCustomerPortal({
        companyId: Number(companyId),
        clientId: Number(clientId),
        documentType: documentType || null,
      });
      notify("Portal issued. Copy the link and send it to the customer.", "success");
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Could not issue the portal.");
      setSaving(false);
    }
  };

  const available = options.filter((o) => o.Available ?? o.available);

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>New Customer Portal</h5>
          <button type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div style={formStyles.body}>
            {error && <div ref={errRef} style={formStyles.error}>{error}</div>}

            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Company</label>
              <select
                style={{ ...dropdownStyles.base, width: "100%" }}
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                {companies.map((c) => <option key={c.id} value={c.id}>{c.brandName || c.name}</option>)}
              </select>
            </div>

            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Customer</label>
              <SearchableSelect
                items={clients}
                value={clientId}
                onChange={(id) => setClientId(id || "")}
                labelKey="name"
                searchKeys={["name", "ntn"]}
                placeholder="Pick the customer this link is for"
              />
              <div style={st.fieldHint}>
                They will see every invoice of theirs on this company — and nothing else.
              </div>
            </div>

            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Document they download</label>
              <select
                style={{ ...dropdownStyles.base, width: "100%" }}
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
              >
                <option value="">Automatic</option>
                {available.some((o) => (o.Type ?? o.type) === "Bill") && <option value="Bill">Bill</option>}
                {available.some((o) => (o.Type ?? o.type) === "TaxInvoice") && <option value="TaxInvoice">Tax Invoice</option>}
              </select>
              {available.length === 0 && (
                <div style={st.fieldHint}>
                  This company has no Bill or Tax Invoice template yet, so the customer will see
                  their invoices but no download. Add a template in Print Templates.
                </div>
              )}
            </div>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }} disabled={saving}>
              {saving ? "Issuing…" : "Issue portal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const st = {
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.9rem" },
  h2: { margin: 0, fontSize: "1.4rem", color: colors.textPrimary },
  countChip: { fontSize: "0.72rem", fontWeight: 700, color: colors.blue, background: "#eef2ff", border: `1px solid ${colors.cardBorder}`, padding: "3px 10px", borderRadius: 12 },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "0 1rem", height: 44, borderRadius: 8, border: "none", background: colors.blue, color: "#fff", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  notice: { padding: "0.6rem 0.9rem", borderRadius: 10, marginBottom: "1rem", background: "#fff3cd", border: "1px solid #ffe69c", color: "#8a5a00", fontSize: "0.83rem", fontWeight: 600, lineHeight: 1.5 },
  list: { display: "grid", gap: "0.85rem" },
  card: { background: colors.cardBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 12, padding: "0.9rem 1rem", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" },
  cardOff: { background: "#fafbfc", borderStyle: "dashed" },
  cardHead: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: 3 },
  client: { fontWeight: 800, fontSize: "0.98rem", color: colors.textPrimary, overflowWrap: "anywhere" },
  activeChip: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#e8f5e9", color: "#1b5e20", padding: "1px 7px", borderRadius: 10 },
  offChip: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#eceff1", color: "#607d8b", padding: "1px 7px", borderRadius: 10 },
  warnChip: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", background: "#fff3cd", color: "#8a5a00", padding: "1px 7px", borderRadius: 10 },
  meta: { fontSize: "0.78rem", color: colors.textSecondary, marginBottom: "0.6rem", overflowWrap: "anywhere" },
  linkRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.65rem", background: colors.inputBg, border: `1px solid ${colors.cardBorder}`, borderRadius: 8 },
  linkText: { flex: "1 1 200px", minWidth: 0, fontSize: "0.78rem", fontFamily: "monospace", color: colors.textSecondary, overflowWrap: "anywhere" },
  tokenMask: { letterSpacing: 2, color: colors.textSecondary },
  linkBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0 0.8rem", height: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", textDecoration: "none", boxShadow: "none" },
  cardActions: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.7rem", paddingTop: "0.6rem", borderTop: `1px solid ${colors.cardBorder}` },
  docLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", fontWeight: 600, color: colors.textSecondary },
  rowBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "0 0.9rem", height: 44, minWidth: 44, borderRadius: 8, border: `1px solid ${colors.inputBorder}`, background: "#fff", color: colors.blue, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", boxShadow: "none" },
  rowBtnDanger: { color: colors.danger, borderColor: `${colors.danger}40` },
  fieldHint: { fontSize: "0.74rem", color: colors.textSecondary, marginTop: 5, lineHeight: 1.45 },
  empty: { padding: "2rem", textAlign: "center", color: colors.textSecondary },
};
