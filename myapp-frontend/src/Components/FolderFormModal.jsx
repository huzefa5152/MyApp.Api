import { useState } from "react";
import { createPortal } from "react-dom";
import { formStyles, modalSizes } from "../theme";
import { createFolder, updateFolder } from "../api/attachmentApi";

// Create or rename a folder. Pass `folder` to rename; omit to create.
// onSaved(savedFolderDto) receives the created/updated folder. Shared by the
// Folders module AND the inline "+ New folder" flow in <AttachmentManager>.
export default function FolderFormModal({ companyId, folder, onClose, onSaved }) {
  const isEdit = !!folder;
  const [name, setName] = useState(folder?.name || "");
  const [description, setDescription] = useState(folder?.description || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    // Stop the submit bubbling through React's component tree to a parent
    // form's onSubmit. <AttachmentManager> (and thus this modal) renders inside
    // the transaction form's <form>; React bubbles synthetic submit events
    // through the tree EVEN ACROSS A PORTAL, so without this the host Sales
    // Quote form would submit + close when you create a folder.
    e.stopPropagation();
    if (saving) return;
    if (!name.trim()) { setError("Folder name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const payload = { name: name.trim(), description: description.trim() || null };
      const res = isEdit ? await updateFolder(folder.id, payload) : await createFolder(companyId, payload);
      onSaved?.(res.data);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || "Could not save the folder.");
      setSaving(false);
    }
  };

  // Portaled to <body> so this modal is NOT inside the parent transaction
  // form's <form> — nested forms made the "Create Folder" submit bubble to the
  // OUTER quote form, saving + closing it. The portal also keeps the z-index
  // stack clean above the parent modal (1100) / ConfirmDialog (1101).
  return createPortal(
    <div style={{ ...formStyles.backdrop, zIndex: 1102 }} onClick={onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }} onClick={(e) => e.stopPropagation()}>
        <div style={formStyles.header}>
          <h5 style={formStyles.title}>{isEdit ? "Rename Folder" : "New Folder"}</h5>
          <button style={formStyles.closeButton} onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={submit}>
          <div style={formStyles.body}>
            {error && <div style={formStyles.error}>{error}</div>}
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Folder Name</label>
              <input autoFocus style={formStyles.input} value={name} maxLength={200}
                onChange={(e) => setName(e.target.value)} placeholder="e.g. Contracts, Certificates" />
            </div>
            <div style={formStyles.formGroup}>
              <label style={formStyles.label}>Description <span style={{ fontWeight: 400 }}>(optional)</span></label>
              <textarea style={{ ...formStyles.input, minHeight: 70, resize: "vertical" }} value={description} maxLength={1000}
                onChange={(e) => setDescription(e.target.value)} placeholder="What goes in this folder?" />
            </div>
          </div>
          <div style={formStyles.footer}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose}>Cancel</button>
            <button type="submit" style={{ ...formStyles.button, ...formStyles.submit, opacity: saving ? 0.6 : 1 }} disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Rename" : "Create Folder"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
