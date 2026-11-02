import { MdEdit, MdDelete, MdContentCopy, MdReceiptLong, MdGroups, MdErrorOutline } from "react-icons/md";
import { useNavigate } from "react-router-dom";
import { deleteClient } from "../api/clientApi";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { Button, IconButton, Facts } from "../ui/Kit";
import { missingFbrDetails } from "./party/partyUtils";

export default function ClientList({ clients, commonGroups, onEdit, onEditCommon, onCopy, fetchClients }) {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const canUpdate = has("clients.manage.update");
  const canDelete = has("clients.manage.delete");
  const canCopy = has("clients.manage.copy");
  // Statement opens the accounting report customer-statement for this client, so it
  // carries that report's permission — a role without it never sees a button
  // that would land on a refusal. All periods: a statement answers "how did
  // this balance come about", which is the whole history.
  const canStatement = has("accounting.reports.view");
  const navigate = useNavigate();
  const openStatement = (c) =>
    navigate(`/accounting/reports/catalog/customer-statement?${new URLSearchParams({ period: "allPeriods", clientId: String(c.id) })}`);

  const handleDelete = async (id) => {
    const ok = await confirm({ title: "Delete Client?", message: "Are you sure you want to delete this client? This action cannot be undone.", variant: "danger", confirmText: "Delete" });
    if (!ok) return;
    try {
      await deleteClient(id);
      fetchClients();
    } catch (err) {
      notify("Failed to delete client.", "error");
    }
  };

  return (
    <div className="k-grid-cards">
      {clients.map((client) => {
        // A client shared with other companies edits through the Common
        // Client form, so the change reaches every company's copy.
        const shared = client.clientGroupId != null ? commonGroups?.get(client.clientGroupId) : null;
        const missing = missingFbrDetails(client);
        const sub = [client.contactPerson, client.site].filter(Boolean).join(" · ");
        return (
        <article key={client.id} className="k-card" style={styles.card} aria-label={client.name}>
          <div className="k-card__body" style={styles.body}>
            <div>
              <h3 style={styles.name} title={client.name}>{client.name}</h3>
              {sub && <div style={styles.sub}>{sub}</div>}
              <div style={styles.tags}>
                <span style={styles.tag}>{client.registrationType || "No type"}</span>
                {shared && (
                  <span style={{ ...styles.tag, ...styles.tagCommon }} title={(shared.companyNames || []).join(", ")}>
                    <MdGroups size={13} aria-hidden="true" /> Common · {shared.companyCount} companies
                  </span>
                )}
              </div>
            </div>
            <Facts
              facts={[
                client.ntn && ["NTN", client.ntn],
                client.strn && ["STRN", client.strn],
                client.cnic && ["CNIC", client.cnic],
                client.phone && ["Phone", client.phone],
                client.email && ["Email", client.email],
                client.address && ["Address", client.address],
              ]}
            />
            {missing.length > 0 && (
              <span style={styles.warn} title="FBR needs these on every invoice">
                <MdErrorOutline size={14} aria-hidden="true" /> FBR details missing: {missing.join(", ")}
              </span>
            )}
            {(canUpdate || canStatement || canDelete || (canCopy && onCopy)) && (
              <div style={styles.actions}>
                {canUpdate && (shared && onEditCommon
                  ? <Button variant="primary" icon={MdEdit} onClick={() => onEditCommon(shared.groupId)} title="Edit for every company that has this client">Edit</Button>
                  : <Button variant="primary" icon={MdEdit} onClick={() => onEdit(client)}>Edit</Button>)}
                {canStatement && (
                  <Button variant="secondary" icon={MdReceiptLong} onClick={() => openStatement(client)} title="Open this client's statement">Statement</Button>
                )}
                {canCopy && onCopy && (
                  <IconButton label="Copy this client into another company" icon={MdContentCopy} onClick={() => onCopy(client)} />
                )}
                {canDelete && (
                  <IconButton label="Delete client" icon={MdDelete} danger onClick={() => handleDelete(client.id)} />
                )}
              </div>
            )}
          </div>
        </article>
        );
      })}
    </div>
  );
}

// Shared entity-card layout (same shape as CompanyList): name, labelled facts, action row.
const styles = {
  // marginTop: 0 cancels the kit's `.k-card + .k-card` stacking gap inside the grid.
  card: { display: "flex", flexDirection: "column", overflow: "hidden", marginTop: 0 },
  body: { flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" },
  name: {
    margin: 0, fontSize: "calc(var(--k-font) + 0.22rem)", fontWeight: 800, lineHeight: 1.3, letterSpacing: "-0.01em", color: "var(--k-ink)",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--k-line)" },
  sub: { marginTop: 2, fontSize: "var(--k-font-sm)", color: "var(--k-muted)", overflowWrap: "anywhere" },
  tags: { display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.4rem" },
  tag: { display: "inline-flex", alignItems: "center", gap: 4, padding: "0.1rem 0.5rem", borderRadius: 999, background: "var(--k-surface-2)", border: "1px solid var(--k-line)", color: "var(--k-ink)", fontSize: "var(--k-font-sm)", fontWeight: 600 },
  tagCommon: { color: "var(--k-blue)" },
  warn: { display: "inline-flex", alignItems: "center", gap: 4, color: "#8a4b00", fontSize: "var(--k-font-sm)", fontWeight: 600 },
};
