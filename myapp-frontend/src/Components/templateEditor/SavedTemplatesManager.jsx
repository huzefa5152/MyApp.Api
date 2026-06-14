import { useState } from "react";
import {
  MdClose, MdStar, MdStarBorder, MdContentCopy, MdEdit, MdDelete,
  MdCheck, MdAdd, MdAutoAwesome,
} from "react-icons/md";
import { formStyles, modalSizes } from "../../theme";

// Manager modal: lists every saved template for the current (type, scope), lets the
// operator set the default, rename, duplicate, delete, and create new ones. The page
// owns all API calls; this component only emits intent. Scope/default are immutable
// here — they are decided at create time / via Set default.
export default function SavedTemplatesManager({
  templateTypeLabel,
  scopeLabel,
  templates,
  currentTemplateId,
  canDelete,
  busy,
  onSelect,
  onSetDefault,
  onDuplicate,
  onRename,
  onDelete,
  onNewBlank,
  onNewFromStarter,
  onClose,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [newName, setNewName] = useState("");

  const startRename = (t) => { setRenamingId(t.id); setRenameValue(t.name); };
  const commitRename = () => {
    const name = renameValue.trim();
    if (name && name !== templates.find((t) => t.id === renamingId)?.name) onRename(renamingId, name);
    setRenamingId(null);
  };
  const commitNew = () => {
    const name = newName.trim();
    if (!name) return;
    onNewBlank(name);
    setNewName("");
  };

  return (
    <div style={s.overlay}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <h3 style={s.title}>Saved Templates</h3>
          <button style={s.closeBtn} onClick={onClose} aria-label="Close"><MdClose size={20} /></button>
        </div>
        <p style={s.subtitle}>
          {templateTypeLabel} &middot; <strong>{scopeLabel}</strong> &mdash; the default (★) is used for printing.
        </p>

        <div style={s.list}>
          {templates.length === 0 && (
            <div style={s.empty}>No templates yet for this scope. Create one below.</div>
          )}
          {templates.map((t) => {
            const isCurrent = t.id === currentTemplateId;
            const isRenaming = renamingId === t.id;
            return (
              <div key={t.id} style={{ ...s.row, ...(isCurrent ? s.rowCurrent : {}) }}>
                <div style={s.rowMain}>
                  <span title={t.isDefault ? "Default for printing" : "Set as default"} style={{ display: "inline-flex", flexShrink: 0 }}>
                    {t.isDefault
                      ? <MdStar size={18} color="#f9a825" />
                      : <MdStarBorder size={18} color="#b0b8c4" />}
                  </span>
                  {isRenaming ? (
                    <input
                      autoFocus
                      style={s.renameInput}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <button
                      style={s.nameBtn}
                      onClick={() => onSelect(t.id)}
                      title="Open in editor"
                    >
                      <span style={s.name}>{t.name}</span>
                      {isCurrent && <span style={s.editingBadge}>editing</span>}
                      {t.isDefault && <span style={s.defaultBadge}>default</span>}
                    </button>
                  )}
                </div>
                <div style={s.actions}>
                  {!t.isDefault && (
                    <button style={s.iconBtn} disabled={busy} onClick={() => onSetDefault(t.id)} title="Set as default">
                      <MdCheck size={16} /> <span style={s.actionLabel}>Default</span>
                    </button>
                  )}
                  <button style={s.iconBtn} disabled={busy} onClick={() => startRename(t)} title="Rename">
                    <MdEdit size={16} /> <span style={s.actionLabel}>Rename</span>
                  </button>
                  <button style={s.iconBtn} disabled={busy} onClick={() => onDuplicate(t)} title="Duplicate">
                    <MdContentCopy size={16} /> <span style={s.actionLabel}>Duplicate</span>
                  </button>
                  {canDelete && (
                    <button style={{ ...s.iconBtn, ...s.iconBtnDanger }} disabled={busy} onClick={() => onDelete(t.id)} title="Delete">
                      <MdDelete size={16} /> <span style={s.actionLabel}>Delete</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={s.newRow}>
          <input
            style={s.newInput}
            placeholder="New template name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitNew(); }}
          />
          <button style={{ ...s.newBtn, ...s.newBtnPrimary }} disabled={busy || !newName.trim()} onClick={commitNew}>
            <MdAdd size={16} /> Create blank
          </button>
          <button style={{ ...s.newBtn, ...s.newBtnOutline }} disabled={busy} onClick={onNewFromStarter}>
            <MdAutoAwesome size={16} /> From starter
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: formStyles.backdrop,
  modal: {
    ...formStyles.modal,
    maxWidth: `${modalSizes.md}px`,
    overflow: "auto",
    padding: "1.5rem",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#1a2332" },
  closeBtn: { border: "none", background: "transparent", cursor: "pointer", color: "#888", padding: 4, borderRadius: 6 },
  subtitle: { margin: "0.25rem 0 1rem", fontSize: "0.85rem", color: "#5f6d7e" },
  list: { display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" },
  empty: { padding: "1.25rem", textAlign: "center", color: "#5f6d7e", fontSize: "0.85rem", background: "#f7f9fc", borderRadius: 8 },
  row: {
    display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
    gap: "0.5rem", padding: "0.6rem 0.75rem", borderRadius: 8,
    border: "1px solid #e8edf3", background: "#fff",
  },
  rowCurrent: { borderColor: "#0d47a1", background: "#f3f7ff" },
  rowMain: { display: "flex", alignItems: "center", gap: "0.5rem", flex: "1 1 200px", minWidth: 0 },
  nameBtn: {
    display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
    border: "none", background: "transparent", cursor: "pointer", padding: 0,
    minWidth: 0, textAlign: "left",
  },
  name: {
    fontSize: "0.9rem", fontWeight: 600, color: "#1a2332",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  defaultBadge: {
    fontSize: "0.62rem", fontWeight: 700, color: "#f57f17", background: "#fff8e1",
    padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0,
  },
  editingBadge: {
    fontSize: "0.62rem", fontWeight: 700, color: "#0d47a1", background: "#e3edff",
    padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0,
  },
  renameInput: {
    flex: 1, minWidth: 0, padding: "0.35rem 0.5rem", fontSize: "0.9rem",
    border: "1px solid #0d47a1", borderRadius: 6, outline: "none",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: "0.35rem", flexShrink: 0 },
  iconBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.25rem",
    border: "1px solid #d0d7e2", background: "#fff", color: "#5f6d7e",
    borderRadius: 6, padding: "0.35rem 0.55rem", fontSize: "0.75rem", fontWeight: 600,
    cursor: "pointer", minHeight: 32,
  },
  iconBtnDanger: { borderColor: "#ef9a9a", color: "#c62828" },
  actionLabel: {},
  newRow: {
    display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center",
    borderTop: "1px solid #e8edf3", paddingTop: "1rem",
  },
  newInput: {
    flex: "1 1 160px", minWidth: 0, padding: "0.5rem 0.65rem", fontSize: "0.85rem",
    border: "1px solid #d0d7e2", borderRadius: 8, outline: "none",
  },
  newBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.35rem",
    borderRadius: 8, padding: "0.5rem 0.8rem", fontSize: "0.82rem", fontWeight: 600,
    cursor: "pointer", minHeight: 40,
  },
  newBtnPrimary: { border: "none", background: "#0d47a1", color: "#fff" },
  newBtnOutline: { border: "1px solid #d0d7e2", background: "#fff", color: "#0d47a1" },
};
