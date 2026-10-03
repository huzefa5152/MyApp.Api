import { MdEdit, MdDelete, MdContentCopy } from "react-icons/md";
import { deleteClient } from "../api/clientApi";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import { Button, Facts } from "../ui/Kit";

export default function ClientList({ clients, onEdit, onCopy, fetchClients }) {
  const confirm = useConfirm();
  const { has } = usePermissions();
  const canUpdate = has("clients.manage.update");
  const canDelete = has("clients.manage.delete");
  const canCopy = has("clients.manage.copy");

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
      {clients.map((client) => (
        <article key={client.id} className="k-card" style={styles.card}>
          <div className="k-card__body" style={styles.body}>
            <h3 style={styles.name} title={client.name}>{client.name}</h3>
            <Facts
              facts={[
                client.email && ["Email", client.email],
                client.phone && ["Phone", client.phone],
                client.address && ["Address", client.address],
                client.ntn && ["NTN", client.ntn],
                client.strn && ["STRN", client.strn],
                client.site && ["Site", client.site],
              ]}
            />
            {(canUpdate || canDelete || canCopy) && (
              <div style={styles.actions}>
                {canUpdate && (
                  <Button variant="primary" icon={MdEdit} onClick={() => onEdit(client)}>Edit</Button>
                )}
                {canCopy && onCopy && (
                  <Button variant="secondary" icon={MdContentCopy} onClick={() => onCopy(client)} title="Copy this client into another company">
                    Copy
                  </Button>
                )}
                {canDelete && (
                  <Button variant="danger" icon={MdDelete} onClick={() => handleDelete(client.id)}>Delete</Button>
                )}
              </div>
            )}
          </div>
        </article>
      ))}
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
};
