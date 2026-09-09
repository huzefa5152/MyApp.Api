import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MdPublic, MdAdd, MdContentCopy, MdOpenInNew, MdCheck, MdBlock,
  MdPlayArrow, MdDelete, MdWarningAmber, MdDescription, MdFilterAltOff,
} from "react-icons/md";
import {
  getCustomerPortals, createCustomerPortal, setCustomerPortalActive, deleteCustomerPortal,
  getPortalDocumentOptions, setCustomerPortalDocumentType,
} from "../api/customerPortalApi";
import { getClientsByCompany } from "../api/clientApi";
import SearchableSelect from "../Components/SearchableSelect";
import StatusBadge from "../Components/StatusBadge";
import ViewModeToggle from "../Components/ViewModeToggle";
import DataTable from "../Components/DataTable";
import { useListViewMode } from "../hooks/useListViewMode";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";
import { useConfirm } from "../Components/ConfirmDialog";
import { notify } from "../utils/notify";
import { formStyles, modalSizes, cardStyles, cardHover, dropdownStyles } from "../theme";

const colors = {
  blue: "#0d47a1", teal: "#00897b", textPrimary: "#1a2332",
  textSecondary: "#5f6d7e", cardBorder: "#e8edf3", amber: "#b26a00", amberBg: "#fff8e1",
};

/**
 * Customer Portal management.
 *
 * The list shows live public URLs. That is the point of the screen — an operator
 * needs to copy the link — but it also means this page displays a credential, so
 * the warning below is deliberate rather than decorative.
 */
export default function CustomerPortalsPage() {
  const confirm = useConfirm();
  const { companies, selectedCompany, loading: loadingCompanies } = useCompany();
  const { has } = usePermissions();
  const canCreate = has("customerportal.manage.create");
  const canUpdate = has("customerportal.manage.update");
  const canDelete = has("customerportal.manage.delete");

  const [portals, setPortals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [created, setCreated] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // ── Filters ───────────────────────────────────────────────────────────────
  // CLIENT-SIDE, over the list this screen has already fetched in full. A
  // portal is one row per (company, client) and an installation has tens of
  // them, so a server round trip per keystroke would buy nothing; the endpoint
  // is already scoped to the caller's accessible companies, which is the part
  // that has to be server-side.
  //
  // Held in the QUERY STRING rather than component state so a filtered view is
  // a link an operator can send, and so browser back/forward behaves — the same
  // choice the Invoices screen already makes for its search and client filters.
  const [searchParams, setSearchParams] = useSearchParams();
  const companyFilter = searchParams.get("companyId") || "";
  const clientFilter = searchParams.get("clientId") || "";
  const statusFilter = searchParams.get("status") || "";
  const searchFilter = searchParams.get("q") || "";

  const setFilters = useCallback((changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(changes)) {
      if (v === "" || v == null) next.delete(k);
      else next.set(k, String(v));
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Options come from the PORTAL ROWS, not from the company and client
  // catalogues. Two reasons: this screen filters portals, so a client with no
  // portal is a dead option; and it makes the Company -> Client dependency fall
  // out for free, with no per-company client fetch and nothing to keep in sync.
  const companyOptions = useMemo(() => {
    const seen = new Map();
    for (const p of portals) if (!seen.has(p.companyId)) seen.set(p.companyId, p.companyName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [portals]);

  const clientOptions = useMemo(() => {
    const seen = new Map();
    for (const p of portals) {
      if (companyFilter && String(p.companyId) !== companyFilter) continue;
      if (!seen.has(p.clientId)) seen.set(p.clientId, p.clientName);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [portals, companyFilter]);

  // A client selection that the chosen company cannot contain is dropped rather
  // than left to filter everything away — a screen showing "no portals" because
  // of an invisible stale filter reads as data loss.
  useEffect(() => {
    if (!clientFilter) return;
    if (clientOptions.some((c) => String(c.id) === clientFilter)) return;
    setFilters({ clientId: "" });
  }, [clientFilter, clientOptions, setFilters]);

  const visiblePortals = useMemo(() => {
    const needle = searchFilter.trim().toLowerCase();
    return portals.filter((p) => {
      if (companyFilter && String(p.companyId) !== companyFilter) return false;
      if (clientFilter && String(p.clientId) !== clientFilter) return false;
      if (statusFilter === "active" && !p.isActive) return false;
      if (statusFilter === "disabled" && p.isActive) return false;
      if (needle && !`${p.clientName} ${p.companyName} ${p.documentTypeLabel}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [portals, companyFilter, clientFilter, statusFilter, searchFilter]);

  const hasFilters = !!(companyFilter || clientFilter || statusFilter || searchFilter);
  const [viewMode, setViewMode, isBigScreen] = useListViewMode("customerPortals");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getCustomerPortals();
      setPortals(data || []);
    } catch {
      setPortals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const copyUrl = async (portal) => {
    try {
      await navigator.clipboard.writeText(portal.publicUrl);
      setCopiedId(portal.id);
      setTimeout(() => setCopiedId((id) => (id === portal.id ? null : id)), 2000);
    } catch {
      // Clipboard needs a secure context; fall back to showing the link so the
      // operator can copy it by hand rather than getting a silent no-op.
      notify(portal.publicUrl, "info");
    }
  };

  const toggleActive = async (portal) => {
    const disabling = portal.isActive;
    const ok = await confirm({
      title: disabling ? `Disable the portal for ${portal.clientName}?` : `Re-enable this portal?`,
      message: disabling
        ? "The link stops working immediately. Re-enabling later restores the same link."
        : "The existing link starts working again straight away.",
      variant: disabling ? "warning" : "info",
      confirmText: disabling ? "Disable" : "Enable",
    });
    if (!ok) return;
    try {
      await setCustomerPortalActive(portal.id, !portal.isActive);
      notify(disabling ? "Portal disabled." : "Portal enabled.", "success");
      reload();
    } catch (err) {
      notify(err.response?.data?.error || "Could not update the portal.", "error");
    }
  };

  /**
   * Switch which document an existing portal serves. The link is untouched, so
   * the customer keeps the URL they already have — only the paper changes.
   * "Automatic" is offered ONLY while a portal is still on it, so legacy portals
   * can move to an explicit choice but nobody can deliberately go back.
   */
  const changeDocument = async (portal, type) => {
    if ((portal.documentType || "") === type) return;
    try {
      await setCustomerPortalDocumentType(portal.id, type || null);
      notify(`Portal now uses the ${type === "TaxInvoice" ? "Tax Invoice" : "Bill"}.`, "success");
      reload();
    } catch (err) {
      notify(err.response?.data?.error || "Could not change the document.", "error");
    }
  };

  const revoke = async (portal) => {
    const ok = await confirm({
      title: `Revoke the portal for ${portal.clientName}?`,
      message: "The link is destroyed permanently. Anyone holding it loses access, and a new portal will have a different link.",
      variant: "danger",
      confirmText: "Revoke",
    });
    if (!ok) return;
    try {
      await deleteCustomerPortal(portal.id);
      notify("Portal revoked.", "success");
      reload();
    } catch (err) {
      notify(err.response?.data?.error || "Could not revoke the portal.", "error");
    }
  };

  const columns = [
    { key: "clientName", header: "Client", accessor: (p) => p.clientName,
      render: (p) => <strong style={{ color: colors.blue }}>{p.clientName}</strong> },
    { key: "companyName", header: "Company", accessor: (p) => p.companyName },
    { key: "documentTypeLabel", header: "Document", accessor: (p) => p.documentTypeLabel,
      render: (p) => <DocumentPicker portal={p} disabled={!canUpdate} onChange={changeDocument} /> },
    { key: "status", header: "Status", accessor: (p) => (p.isActive ? "Active" : "Disabled"),
      render: (p) => <StatusBadge tone={p.isActive ? "success" : "excluded"}>{p.isActive ? "Active" : "Disabled"}</StatusBadge> },
    { key: "createdAt", header: "Created", accessor: (p) => p.createdAt,
      render: (p) => new Date(p.createdAt).toLocaleDateString() },
  ];

  const renderActions = (p) => (
    <>
      <button style={btn.copy} onClick={() => copyUrl(p)} title="Copy the public link">
        {copiedId === p.id ? <MdCheck size={14} /> : <MdContentCopy size={14} />}
      </button>
      <button style={btn.open} onClick={() => window.open(p.publicUrl, "_blank", "noopener")}
              title="Open the portal in a new tab">
        <MdOpenInNew size={14} />
      </button>
      {canUpdate && (
        <button style={p.isActive ? btn.disable : btn.enable} onClick={() => toggleActive(p)}
                title={p.isActive ? "Disable this portal" : "Enable this portal"}>
          {p.isActive ? <MdBlock size={14} /> : <MdPlayArrow size={14} />}
        </button>
      )}
      {canDelete && (
        <button style={btn.revoke} onClick={() => revoke(p)} title="Revoke permanently">
          <MdDelete size={14} />
        </button>
      )}
    </>
  );

  return (
    <div>
      <div style={st.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={st.icon}><MdPublic size={26} color="#fff" /></div>
          <div>
            <h4 style={st.title}>Customer Portal</h4>
            <p style={st.subtitle}>
              {/* When a filter is on, the phrase is "1 of 2 portals" — the
                  plural follows the TOTAL, not the visible count. */}
              Public invoice links — {visiblePortals.length}
              {hasFilters ? ` of ${portals.length}` : ""} portal
              {(hasFilters ? portals.length : visiblePortals.length) === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {isBigScreen && <ViewModeToggle mode={viewMode} onChange={setViewMode} />}
          {canCreate && (
            <button style={st.addBtn} onClick={() => setShowForm(true)}>
              <MdAdd size={18} /> Create Customer Portal
            </button>
          )}
        </div>
      </div>

      <div style={st.warning}>
        <MdWarningAmber size={18} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Anyone with a portal link can see that client's invoices — no password is
          required. Share a link only with the customer it belongs to, and revoke it
          if it is ever forwarded by mistake.
        </span>
      </div>

      {/* Filter bar. Shown whenever there is anything to filter, like the
          Invoices screen's — NOT only once a second portal exists. Hiding it
          below a threshold makes the control invisible to the person looking
          for it and its absence indistinguishable from a bug. Styling reuses
          the shared dropdown/form tokens so it matches every other filter bar
          in the app. */}
      {portals.length > 0 && (
        <div style={st.filterBar}>
          <label style={st.filterField}>
            <span style={st.filterLabel}>Company</span>
            <select style={{ ...dropdownStyles.base, ...st.filterInput }} value={companyFilter}
                    onChange={(e) => setFilters({ companyId: e.target.value, clientId: "" })}>
              <option value="">All companies</option>
              {companyOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={st.filterField}>
            <span style={st.filterLabel}>Client</span>
            <select style={{ ...dropdownStyles.base, ...st.filterInput }} value={clientFilter}
                    onChange={(e) => setFilters({ clientId: e.target.value })}>
              <option value="">All clients</option>
              {clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={st.filterField}>
            <span style={st.filterLabel}>Status</span>
            <select style={{ ...dropdownStyles.base, ...st.filterInput }} value={statusFilter}
                    onChange={(e) => setFilters({ status: e.target.value })}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label style={{ ...st.filterField, flex: "2 1 180px" }}>
            <span style={st.filterLabel}>Search</span>
            <input type="search" style={st.filterInput} value={searchFilter}
                   placeholder="Client, company or document"
                   onChange={(e) => setFilters({ q: e.target.value })} />
          </label>
          {hasFilters && (
            <button type="button" style={st.filterClear}
                    onClick={() => setFilters({ companyId: "", clientId: "", status: "", q: "" })}>
              <MdFilterAltOff size={15} /> Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div style={st.loading}><div style={st.spinner} /></div>
      ) : portals.length > 0 && visiblePortals.length === 0 ? (
        <div style={st.empty}>
          <MdFilterAltOff size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
            No portal matches these filters.
          </p>
          <button style={st.addBtn} onClick={() => setFilters({ companyId: "", clientId: "", status: "", q: "" })}>
            Clear filters
          </button>
        </div>
      ) : portals.length === 0 ? (
        <div style={st.empty}>
          <MdPublic size={40} color={colors.cardBorder} />
          <p style={{ color: colors.textSecondary, marginTop: "0.5rem" }}>
            No customer portals yet. Create one to give a client a link to their invoices.
          </p>
        </div>
      ) : viewMode === "table" ? (
        <DataTable
          columns={columns}
          rows={visiblePortals}
          rowKey={(p) => p.id}
          actions={renderActions}
          quickSearchPlaceholder="Quick filter visible rows..."
          storageKey="customerPortals"
          emptyMessage="No customer portals on this page."
        />
      ) : (
        <div className="card-grid">
          {visiblePortals.map((p) => (
            <div key={p.id} style={cardStyles.card}
                 onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
                 onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" })}>
              <div style={cardStyles.cardContent}>
                <div>
                  <h5 style={cardStyles.title}>{p.clientName}</h5>
                  <p style={cardStyles.text}><strong>Company:</strong> {p.companyName}</p>
                  <div style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong>Document:</strong>
                    <DocumentPicker portal={p} disabled={!canUpdate} onChange={changeDocument} />
                  </div>
                  <p style={cardStyles.text}><strong>Created:</strong> {new Date(p.createdAt).toLocaleDateString()}</p>
                  <div style={{ margin: "0.4rem 0" }}>
                    <StatusBadge tone={p.isActive ? "success" : "excluded"}>
                      {p.isActive ? "Active" : "Disabled"}
                    </StatusBadge>
                  </div>
                  <code style={st.url}>{p.publicUrl}</code>
                </div>
                <div style={{ ...cardStyles.buttonGroup, flexWrap: "wrap" }}>{renderActions(p)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <CreatePortalModal
          companies={companies}
          defaultCompanyId={selectedCompany?.id}
          loadingCompanies={loadingCompanies}
          onClose={() => setShowForm(false)}
          onCreated={(portal) => { setShowForm(false); setCreated(portal); reload(); }}
        />
      )}

      {created && (
        <CreatedModal portal={created} onCopy={copyUrl} copied={copiedId === created.id}
                      onClose={() => setCreated(null)} />
      )}
    </div>
  );
}

/**
 * Inline document switcher for a portal that already exists. Options a company
 * has no template for are shown but disabled — hiding them entirely would leave
 * an operator wondering why the document they expected isn't listed.
 */
function DocumentPicker({ portal, disabled, onChange }) {
  const available = portal.availableDocumentTypes || [];
  const isAuto = !portal.documentType;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <select
        value={portal.documentType || ""}
        disabled={disabled}
        onChange={(e) => onChange(portal, e.target.value)}
        title={portal.templateAvailable
          ? `Customers download the ${portal.documentTypeLabel}`
          : "No template of this type on the company — customers see no Print or Download"}
        style={{ ...st.docSelect, ...(portal.templateAvailable ? null : st.docSelectWarn) }}
      >
        {/* Only while it's still automatic — a one-way exit from the legacy default. */}
        {isAuto && <option value="">Automatic</option>}
        <option value="Bill" disabled={!available.includes("Bill")}>
          Bill{available.includes("Bill") ? "" : " (no template)"}
        </option>
        <option value="TaxInvoice" disabled={!available.includes("TaxInvoice")}>
          Tax Invoice{available.includes("TaxInvoice") ? "" : " (no template)"}
        </option>
      </select>
      {!portal.templateAvailable && <span style={st.noTemplate}>no template</span>}
    </span>
  );
}

function CreatePortalModal({ companies, defaultCompanyId, loadingCompanies, onClose, onCreated }) {
  const [companyId, setCompanyId] = useState(defaultCompanyId ? String(defaultCompanyId) : "");
  const [clientId, setClientId] = useState("");
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [docOptions, setDocOptions] = useState([]);
  const [documentType, setDocumentType] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!companyId) { setClients([]); setClientId(""); return; }
    let cancelled = false;
    setLoadingClients(true);
    getClientsByCompany(companyId)
      .then(({ data }) => { if (!cancelled) setClients(data || []); })
      .catch(() => { if (!cancelled) setClients([]); })
      .finally(() => { if (!cancelled) setLoadingClients(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  // Which documents this company can actually produce. Offering a type with no
  // template would create a portal whose Print and Download never appear.
  useEffect(() => {
    if (!companyId) { setDocOptions([]); setDocumentType(""); return; }
    let cancelled = false;
    getPortalDocumentOptions(companyId)
      .then(({ data }) => {
        if (cancelled) return;
        const opts = data || [];
        setDocOptions(opts);
        const firstReady = opts.find((o) => o.available);
        setDocumentType(firstReady ? firstReady.type : "");
      })
      .catch(() => { if (!cancelled) setDocOptions([]); });
    return () => { cancelled = true; };
  }, [companyId]);

  const noTemplates = docOptions.length > 0 && !docOptions.some((o) => o.available);

  const submit = async () => {
    if (!companyId || !clientId || saving) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await createCustomerPortal(
        Number(companyId), Number(clientId), documentType || null);
      onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not create the portal.");
      setSaving(false);
    }
  };

  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }}
           onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Create Customer Portal</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <div style={formStyles.body}>
          {error && <div style={st.err}>{error}</div>}

          <label style={st.label}>Company</label>
          <select
            style={{ ...dropdownStyles.base, width: "100%", marginBottom: "1rem" }}
            value={companyId}
            disabled={loadingCompanies}
            onChange={(e) => { setCompanyId(e.target.value); setClientId(""); }}
          >
            <option value="">Select a company…</option>
            {(companies || []).map((co) => (
              <option key={co.id} value={co.id}>{co.name}</option>
            ))}
          </select>

          <label style={st.label}>Client</label>
          <SearchableSelect
            items={clients}
            value={clientId}
            onChange={setClientId}
            valueKey="id"
            labelKey="name"
            searchKeys={["name", "ntn", "phone"]}
            style={dropdownStyles.base}
            loading={loadingClients}
            placeholder={
              !companyId ? "Pick a company first"
                : loadingClients ? "Loading clients…"
                : "Select a client…"
            }
            disabled={!companyId || loadingClients}
          />

          <div style={{ marginTop: "1.1rem" }}>
            <label style={st.label}>Invoice document</label>
            <p style={st.subHint}>
              What the customer downloads and prints. The portal always uses this one.
            </p>
            <div style={st.docRow}>
              {docOptions.map((o) => {
                const active = documentType === o.type;
                return (
                  <button
                    key={o.type}
                    type="button"
                    disabled={!o.available}
                    onClick={() => setDocumentType(o.type)}
                    title={o.available
                      ? `Use the ${o.label} template`
                      : `This company has no ${o.label} template yet`}
                    style={{ ...st.docBtn, ...(active ? st.docBtnActive : null),
                             ...(o.available ? null : st.docBtnOff) }}
                  >
                    <MdDescription size={15} />
                    <span>{o.label}</span>
                    {!o.available && <span style={st.docBtnTag}>no template</span>}
                  </button>
                );
              })}
            </div>
            {noTemplates && (
              <p style={st.warnHint}>
                This company has no Bill or Tax Invoice print template yet. The portal
                will still list invoices, but customers won't see Print or Download
                until you add one.
              </p>
            )}
          </div>

          <p style={st.hint}>
            One active portal per client. The link is generated by the system and can
            be disabled or revoked at any time.
          </p>
        </div>
        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...formStyles.button, ...formStyles.submit,
                     opacity: companyId && clientId && !saving ? 1 : 0.6 }}
            disabled={!companyId || !clientId || saving}
            onClick={submit}
          >
            {saving ? "Creating…" : "Create Portal"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreatedModal({ portal, onCopy, copied, onClose }) {
  return (
    <div style={formStyles.backdrop}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px`, cursor: "default" }}
           onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>Customer Portal Created</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <div style={formStyles.body}>
          <p style={{ ...cardStyles.text, marginBottom: "0.25rem" }}><strong>Client</strong></p>
          <p style={{ fontWeight: 700, marginBottom: "1rem" }}>{portal.clientName}</p>

          <p style={{ ...cardStyles.text, marginBottom: "0.25rem" }}><strong>Public URL</strong></p>
          <code style={st.url}>{portal.publicUrl}</code>

          <div style={st.warning}>
            <MdWarningAmber size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Anyone with this link can access this client's invoices. Share it only
              with the intended client.
            </span>
          </div>
        </div>
        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }}
                  onClick={() => window.open(portal.publicUrl, "_blank", "noopener")}>
            <MdOpenInNew size={15} /> Open Portal
          </button>
          <button type="button" style={{ ...formStyles.button, ...formStyles.submit }}
                  onClick={() => onCopy(portal)}>
            {copied ? <><MdCheck size={15} /> Copied</> : <><MdContentCopy size={15} /> Copy URL</>}
          </button>
        </div>
      </div>
    </div>
  );
}

const baseBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 28, borderRadius: 6, border: "none", cursor: "pointer", padding: 0,
};
const btn = {
  copy:   { ...baseBtn, backgroundColor: "#e8eaf6", color: "#283593", border: "1px solid #9fa8da" },
  open:   { ...baseBtn, backgroundColor: "#e3f2fd", color: "#0d47a1", border: "1px solid #90caf9" },
  disable:{ ...baseBtn, backgroundColor: "#fff8e1", color: "#b26a00", border: "1px solid #ffe082" },
  enable: { ...baseBtn, backgroundColor: "#e8f5e9", color: "#1b5e20", border: "1px solid #a5d6a7" },
  revoke: { ...baseBtn, backgroundColor: "#ffebee", color: "#b71c1c", border: "1px solid #ef9a9a" },
};

const st = {
  filterBar: { display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end",
    background: "#fff", border: `1px solid ${colors.cardBorder}`, borderRadius: 10,
    padding: "0.65rem 0.8rem", marginBottom: "0.9rem" },
  filterField: { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 150px", minWidth: 0 },
  filterLabel: { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.05em", color: colors.textSecondary },
  filterInput: { padding: "0.42rem 0.55rem", borderRadius: 7, border: `1px solid #d0d7e2`,
    background: "#f8f9fb", fontSize: "0.84rem", color: colors.textPrimary, minHeight: 38, width: "100%" },
  filterClear: { display: "inline-flex", alignItems: "center", gap: 5, minHeight: 38,
    padding: "0.42rem 0.7rem", borderRadius: 7, border: `1px solid #d0d7e2`, background: "#fff",
    color: colors.textPrimary, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" },
  icon: { width: 48, height: 48, borderRadius: 14,
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { margin: 0, fontSize: "1.5rem", fontWeight: 700, color: colors.textPrimary },
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.88rem", color: colors.textSecondary },
  addBtn: { display: "inline-flex", alignItems: "center", gap: "0.4rem",
    padding: "0.55rem 1.25rem", borderRadius: 10, border: "none",
    background: `linear-gradient(135deg, ${colors.blue}, ${colors.teal})`, color: "#fff",
    fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
  warning: { display: "flex", gap: "0.6rem", alignItems: "flex-start",
    backgroundColor: colors.amberBg, color: colors.amber, border: "1px solid #ffe082",
    borderRadius: 10, padding: "0.7rem 1rem", marginBottom: "1.25rem", fontSize: "0.85rem", lineHeight: 1.45 },
  url: { display: "block", wordBreak: "break-all", backgroundColor: "#f8f9fb",
    border: `1px solid ${colors.cardBorder}`, borderRadius: 8, padding: "0.5rem 0.7rem",
    fontSize: "0.78rem", color: colors.textPrimary },
  label: { display: "block", marginBottom: "0.35rem", fontWeight: 600,
    fontSize: "0.85rem", color: colors.textSecondary },
  hint: { marginTop: "1rem", fontSize: "0.8rem", color: colors.textSecondary },
  subHint: { margin: "0 0 0.5rem", fontSize: "0.78rem", color: colors.textSecondary },
  warnHint: { marginTop: "0.6rem", fontSize: "0.78rem", color: colors.amber,
    background: colors.amberBg, border: "1px solid #ffe082", borderRadius: 8, padding: "0.5rem 0.7rem" },
  docRow: { display: "flex", gap: "0.5rem", flexWrap: "wrap" },
  docBtn: { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44,
    padding: "0.55rem 0.9rem", borderRadius: 10, border: `1px solid ${colors.cardBorder}`,
    background: "#fff", color: colors.textSecondary, fontSize: "0.86rem", fontWeight: 600, cursor: "pointer" },
  docBtnActive: { borderColor: colors.blue, background: "#e8f0fe", color: colors.blue },
  docBtnOff: { opacity: 0.5, cursor: "not-allowed" },
  docBtnTag: { fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.03em", color: colors.amber },
  noTemplate: { marginLeft: 2, fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.03em", color: colors.amber },
  docSelect: { minHeight: 34, padding: "0.25rem 0.45rem", borderRadius: 8,
    border: `1px solid ${colors.cardBorder}`, background: "#fff", color: colors.textPrimary,
    fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" },
  docSelectWarn: { borderColor: "#ffe082", background: colors.amberBg },
  err: { backgroundColor: "#fff0f1", color: "#dc3545", padding: "0.65rem 1rem",
    borderRadius: 8, marginBottom: "1rem", fontWeight: 500, fontSize: "0.85rem" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`,
    borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center",
    padding: "3rem 1rem", textAlign: "center" },
};
