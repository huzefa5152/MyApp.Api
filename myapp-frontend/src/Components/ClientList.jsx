import { MdEdit, MdDelete, MdContentCopy, MdReceiptLong } from "react-icons/md";
import { useNavigate } from "react-router-dom";
import { deleteClient } from "../api/clientApi";
import { useConfirm } from "./ConfirmDialog";
import { usePermissions } from "../contexts/PermissionsContext";
import { notify } from "../utils/notify";
import PartyCard from "./party/PartyCard";

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
    <div className="pd-grid">
      {clients.map((client, i) => {
        // A client shared with other companies edits through the Common
        // Client form, so the change reaches every company's copy.
        const shared = client.clientGroupId != null ? commonGroups?.get(client.clientGroupId) : null;
        return (
        <PartyCard
          key={client.id}
          party={client}
          shared={shared}
          style={{ animationDelay: `${Math.min(i, 12) * 0.03}s` }}
          actions={[
            canUpdate && (shared && onEditCommon
              ? { key: "edit", label: "Edit", icon: <MdEdit size={16} />, variant: "primary", onClick: () => onEditCommon(shared.groupId), title: "Edit for every company that has this client" }
              : { key: "edit", label: "Edit", icon: <MdEdit size={16} />, variant: "primary", onClick: () => onEdit(client) }),
            canStatement && { key: "statement", label: "Statement", icon: <MdReceiptLong size={16} />, onClick: () => openStatement(client), title: "Open this client's statement" },
            canCopy && onCopy && { key: "copy", label: "Copy", icon: <MdContentCopy size={16} />, iconOnly: true, onClick: () => onCopy(client), title: "Copy this client into another company" },
            canDelete && { key: "delete", label: "Delete", icon: <MdDelete size={17} />, iconOnly: true, variant: "danger", onClick: () => handleDelete(client.id), title: "Delete client" },
          ].filter(Boolean)}
        />
        );
      })}
    </div>
  );
}
