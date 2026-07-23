import { MdClose, MdAttachFile } from "react-icons/md";
import { formStyles, modalSizes } from "../theme";
import AttachmentManager from "./AttachmentManager";

// Lightweight modal for viewing / adding a document's attachments straight from
// a list, without opening the full edit form. Reuses <AttachmentManager> in
// entity mode — all upload / download / delete UI inside it stays permission-
// gated. `onClose` fires after any change so the list can refresh its badge
// counts.
export default function AttachmentQuickModal({ companyId, entityType, entityId, title, onClose }) {
  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={{ ...formStyles.title, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <MdAttachFile size={18} /> {title || "Attachments"}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}><MdClose size={18} /></button>
        </div>
        <div style={formStyles.body}>
          <AttachmentManager
            companyId={companyId}
            entityType={entityType}
            entityId={entityId}
            mode="edit"
            title="Attachments"
          />
        </div>
        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
