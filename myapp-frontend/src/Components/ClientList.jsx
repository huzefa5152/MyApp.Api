import { MdEmail, MdPhone, MdLocationOn, MdEdit, MdDelete, MdContentCopy } from "react-icons/md";
import { deleteClient, getClientDeleteImpact } from "../api/clientApi";
import { cardStyles, cardHover } from "../theme";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";

export default function ClientList({ clients, onEdit, onCopy, fetchClients }) {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const canUpdate = has("clients.manage.update");
  const canDelete = has("clients.manage.delete");
  const canCopy = has("clients.manage.copy");

  const handleDelete = async (client) => {
    // Look up what the wipe will cascade-delete (best-effort; falls back to a
    // plain confirm if the impact call isn't available).
    let impact = null;
    try { ({ data: impact } = await getClientDeleteImpact(client.id)); } catch { /* plain confirm */ }

    // FBR-submitted bills block the delete (compliance).
    if (impact && impact.fbrSubmittedInvoices > 0) {
      await confirm({
        title: "Can't delete this client",
        message: `"${client.name}" has ${impact.fbrSubmittedInvoices} FBR-submitted bill${impact.fbrSubmittedInvoices !== 1 ? "s" : ""}, which can't be deleted for compliance. Handle those in the Invoices tab first.`,
        variant: "warning", confirmText: "OK", cancelText: "Close",
      });
      return;
    }

    const parts = [];
    if (impact) {
      if (impact.invoices) parts.push(`${impact.invoices} bill/invoice${impact.invoices !== 1 ? "s" : ""}`);
      if (impact.deliveryChallans) parts.push(`${impact.deliveryChallans} delivery challan${impact.deliveryChallans !== 1 ? "s" : ""}`);
      if (impact.salesOrders) parts.push(`${impact.salesOrders} sales order${impact.salesOrders !== 1 ? "s" : ""}`);
      if (impact.salesQuotes) parts.push(`${impact.salesQuotes} sales quote${impact.salesQuotes !== 1 ? "s" : ""}`);
    }
    const message = parts.length
      ? `Deleting "${client.name}" will also permanently delete ${parts.join(", ")} (and their attachments). This cannot be undone.`
      : `Delete "${client.name}"? This cannot be undone.`;

    const ok = await confirm({ title: "Delete Client?", message, variant: "danger", confirmText: parts.length ? "Delete client + documents" : "Delete" });
    if (!ok) return;
    try {
      await deleteClient(client.id);
      fetchClients();
      notify("Client deleted.", "success");
    } catch (err) {
      notify(err.response?.data?.error || err.response?.data?.message || "Failed to delete client.", "error");
    }
  };

  return (
    <div className="card-grid">
      {clients.map((client) => (
        <div
          key={client.id}
          style={cardStyles.card}
          onMouseEnter={(e) => Object.assign(e.currentTarget.style, cardHover)}
          onMouseLeave={(e) =>
            Object.assign(e.currentTarget.style, {
              transform: "none",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            })
          }
        >
          <div style={cardStyles.cardContent}>
            <div>
              <h5 style={cardStyles.title}>{client.name}</h5>
              {client.email && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdEmail style={{ color: "#0d47a1", flexShrink: 0 }} /> {client.email}
                </p>
              )}
              {client.phone && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdPhone style={{ color: "#00897b", flexShrink: 0 }} /> {client.phone}
                </p>
              )}
              {client.address && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MdLocationOn style={{ color: "#5f6d7e", flexShrink: 0 }} /> {client.address}
                </p>
              )}
              {client.ntn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>NTN:</strong> {client.ntn}
                </p>
              )}
              {client.strn && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>STRN:</strong> {client.strn}
                </p>
              )}
              {client.site && (
                <p style={{ ...cardStyles.text, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <strong style={{ fontSize: "0.75rem", color: "#5f6d7e" }}>Site:</strong> {client.site}
                </p>
              )}
            </div>
            {(canUpdate || canDelete || canCopy) && (
              <div style={cardStyles.buttonGroup}>
                {canUpdate && (
                  <button
                    style={{ ...cardStyles.button, ...cardStyles.edit, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => onEdit(client)}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.08)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
                  >
                    <MdEdit /> Edit
                  </button>
                )}
                {canCopy && onCopy && (
                  <button
                    style={{ ...cardStyles.button, backgroundColor: "#ede7f6", color: "#4527a0", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => onCopy(client)}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(0.97)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
                    title="Copy this client into another company"
                  >
                    <MdContentCopy /> Copy
                  </button>
                )}
                {canDelete && (
                  <button
                    style={{ ...cardStyles.button, ...cardStyles.delete, display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => handleDelete(client)}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(0.95)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = ""; }}
                  >
                    <MdDelete /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
