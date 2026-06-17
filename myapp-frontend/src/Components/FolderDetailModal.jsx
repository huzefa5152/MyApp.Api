import { MdClose, MdFolder } from "react-icons/md";
import { formStyles, modalSizes } from "../theme";
import AttachmentManager from "./AttachmentManager";

// Opens a folder and manages its documents by REUSING <AttachmentManager> in
// folder mode — the same component the transaction modules use, proving the
// "one component, many use cases" goal.
export default function FolderDetailModal({ companyId, folder, onClose }) {
  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={{ ...formStyles.title, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <MdFolder size={20} /> {folder.name}
          </h5>
          <button style={formStyles.closeButton} onClick={onClose}><MdClose size={18} /></button>
        </div>
        <div style={formStyles.body}>
          {folder.description && (
            <p style={{ marginTop: 0, marginBottom: "0.5rem", color: "#5f6d7e", fontSize: "0.85rem" }}>{folder.description}</p>
          )}
          <AttachmentManager
            companyId={companyId}
            folderContext={folder.uncategorized ? null : folder.id}
            uncategorized={!!folder.uncategorized}
            title="Documents"
          />
        </div>
        <div style={formStyles.footer}>
          <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
