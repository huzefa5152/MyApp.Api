import { useCallback, useEffect, useState } from "react";
import {
  MdPublic, MdAdd, MdContentCopy, MdOpenInNew, MdCheck, MdBlock,
  MdPlayArrow, MdDelete, MdWarningAmber,
} from "react-icons/md";
import {
  getCustomerPortals, createCustomerPortal, setCustomerPortalActive, deleteCustomerPortal,
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
              Public invoice links — {portals.length} portal{portals.length === 1 ? "" : "s"}
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

      {loading ? (
        <div style={st.loading}><div style={st.spinner} /></div>
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
          rows={portals}
          rowKey={(p) => p.id}
          actions={renderActions}
          quickSearchPlaceholder="Quick filter visible rows..."
          storageKey="customerPortals"
          emptyMessage="No customer portals on this page."
        />
      ) : (
        <div className="card-grid">
          {portals.map((p) => (
            <div key={p.id} style={cardStyles.card}
                 onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
                 onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" })}>
              <div style={cardStyles.cardContent}>
                <div>
                  <h5 style={cardStyles.title}>{p.clientName}</h5>
                  <p style={cardStyles.text}><strong>Company:</strong> {p.companyName}</p>
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

function CreatePortalModal({ companies, defaultCompanyId, loadingCompanies, onClose, onCreated }) {
  const [companyId, setCompanyId] = useState(defaultCompanyId ? String(defaultCompanyId) : "");
  const [clientId, setClientId] = useState("");
  const [clients, setClients] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);
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

  const submit = async () => {
    if (!companyId || !clientId || saving) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await createCustomerPortal(Number(companyId), Number(clientId));
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
  err: { backgroundColor: "#fff0f1", color: "#dc3545", padding: "0.65rem 1rem",
    borderRadius: 8, marginBottom: "1rem", fontWeight: 500, fontSize: "0.85rem" },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem 0" },
  spinner: { width: 28, height: 28, border: `3px solid ${colors.cardBorder}`,
    borderTopColor: colors.blue, borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { display: "flex", flexDirection: "column", alignItems: "center",
    padding: "3rem 1rem", textAlign: "center" },
};
