import { MdEmail, MdPhone, MdLocationOn, MdEdit, MdDelete, MdContentCopy, MdReceiptLong } from "react-icons/md";
import { useNavigate } from "react-router-dom";
import { deleteClient } from "../api/clientApi";
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
            {(canUpdate || canDelete || canCopy || canStatement) && (
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
                {canStatement && (
                  <button
                    type="button"
                    style={{ ...cardStyles.button, backgroundColor: "#e0f2f1", color: "#00695c", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                    onClick={() => openStatement(client)}
                    title="Open this client's statement"
                  >
                    <MdReceiptLong /> Statement
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
                    onClick={() => handleDelete(client.id)}
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
