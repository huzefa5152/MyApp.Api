import { useRef, useState } from "react";
import {
  MdClose, MdStar, MdStarBorder, MdContentCopy, MdEdit, MdDelete, MdCheck, MdAdd,
  MdSwapHoriz, MdGridOn, MdOpenInNew,
} from "react-icons/md";
import { formStyles, modalSizes } from "../../theme";
import { TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL } from "../../utils/templateSampleData";

/**
 * Everything about one document type's templates, in one place, from inside
 * the editor: open another, make one the default, rename it in place,
 * duplicate it, copy it to a different document type, delete it, or start a
 * new one. The page owns every API call; this component only says what the
 * operator asked for.
 *
 * Feedback contract: `busyId` is the template an action is running on (that
 * row shows a spinner and dims); `busy` locks every row while anything runs
 * so two actions can never race each other.
 */
export default function SavedTemplatesManager({
  templateType,
  templates,
  currentTemplateId,
  canDelete,
  busy,
  busyId = null,
  onSelect,
  onSetDefault,
  onDuplicate,
  onRename,
  onCopyToType,
  onDelete,
  onNew,
  onClose,
}) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [copyingId, setCopyingId] = useState(null);
  const [copyType, setCopyType] = useState("");
  // Enter commits and then the input blurs — this makes sure the rename is
  // sent once, and that Escape cancels without sending anything.
  const renameCommitted = useRef(false);

  const typeLabel = TEMPLATE_TYPE_LABEL[templateType] || templateType;
  const otherTypes = TEMPLATE_TYPES.filter((t) => t.value !== templateType);

  const startRename = (t) => {
    renameCommitted.current = false;
    setCopyingId(null);
    setRenamingId(t.id);
    setRenameValue(t.name);
  };
  const cancelRename = () => { renameCommitted.current = true; setRenamingId(null); };
  const commitRename = () => {
    if (renameCommitted.current) return;
    renameCommitted.current = true;
    const id = renamingId;
    const current = templates.find((t) => t.id === id);
    const next = renameValue.trim();
    setRenamingId(null);
    if (id != null && next && current && next !== current.name) onRename(id, next);
  };

  const startCopy = (t) => {
    setRenamingId(null);
    setCopyingId(t.id);
    setCopyType(otherTypes[0]?.value || "");
  };

  return (
    <div style={formStyles.backdrop} onClick={busy ? undefined : onClose}>
      <div style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="tpl-mgr-title">
        <div style={formStyles.header}>
          <div>
            <h3 id="tpl-mgr-title" style={formStyles.title}>{typeLabel} templates</h3>
            <p style={s.subtitle}>The default (★) is what this document type prints with unless a screen picks another.</p>
          </div>
          <button type="button" style={formStyles.closeButton} onClick={onClose} disabled={busy} aria-label="Close"><MdClose size={20} /></button>
        </div>

        <div style={formStyles.body}>
          {templates.length === 0 && (
            <div style={s.empty}>No saved {typeLabel} template yet. The editor is showing the built-in default — save it, or start a new one below.</div>
          )}
          <div style={s.list}>
            {templates.map((t) => {
              const isCurrent = t.id === currentTemplateId;
              const rowBusy = busyId === t.id;
              return (
                <div key={t.id} style={{ ...s.row, ...(isCurrent ? s.rowCurrent : {}), ...(rowBusy ? s.rowBusy : {}) }}>
                  <div style={s.rowMain}>
                    <span title={t.isDefault ? "Default for printing" : "Not the default"} style={{ display: "inline-flex", flexShrink: 0 }}>
                      {t.isDefault ? <MdStar size={20} color="#f9a825" /> : <MdStarBorder size={20} color="#b0b8c4" />}
                    </span>
                    {renamingId === t.id ? (
                      <input
                        autoFocus aria-label="Template name"
                        style={s.renameInput}
                        value={renameValue}
                        maxLength={120}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                          if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                        }}
                        onBlur={commitRename}
                      />
                    ) : (
                      <button type="button" style={s.nameBtn} onClick={() => onSelect(t.id)} disabled={busy || isCurrent}
                        title={isCurrent ? "Open in the editor now" : "Open in the editor"}>
                        <span style={s.name}>{t.name}</span>
                        {isCurrent && <span style={s.editingBadge}>editing</span>}
                        {t.isDefault && <span style={s.defaultBadge}>default</span>}
                        {t.hasExcelTemplate && <span style={s.excelBadge}><MdGridOn size={11} /> Excel</span>}
                      </button>
                    )}
                  </div>

                  <div style={s.actions}>
                    {rowBusy && <span style={s.spinner} aria-label="Working…" />}
                    {!isCurrent && (
                      <button type="button" style={s.iconBtn} disabled={busy} onClick={() => onSelect(t.id)} title="Open in the editor">
                        <MdOpenInNew size={16} /> <span>Open</span>
                      </button>
                    )}
                    {!t.isDefault && (
                      <button type="button" style={s.iconBtn} disabled={busy} onClick={() => onSetDefault(t.id)} title="Use this template for printing">
                        <MdCheck size={16} /> <span>Set default</span>
                      </button>
                    )}
                    <button type="button" style={s.iconBtn} disabled={busy} onClick={() => startRename(t)} title="Rename">
                      <MdEdit size={16} /> <span>Rename</span>
                    </button>
                    <button type="button" style={s.iconBtn} disabled={busy} onClick={() => onDuplicate(t)} title="Duplicate (same document type)">
                      <MdContentCopy size={16} /> <span>Duplicate</span>
                    </button>
                    {otherTypes.length > 0 && (
                      <button type="button" style={{ ...s.iconBtn, ...(copyingId === t.id ? s.iconBtnOn : {}) }} disabled={busy}
                        onClick={() => (copyingId === t.id ? setCopyingId(null) : startCopy(t))}
                        title="Reuse this design for another document type">
                        <MdSwapHoriz size={16} /> <span>Copy to…</span>
                      </button>
                    )}
                    {canDelete && (
                      <button type="button" style={{ ...s.iconBtn, ...s.iconBtnDanger }} disabled={busy} onClick={() => onDelete(t)} title="Delete">
                        <MdDelete size={16} /> <span>Delete</span>
                      </button>
                    )}
                  </div>

                  {copyingId === t.id && (
                    <div style={s.copyRow}>
                      <span style={s.copyHint}>Copy “{t.name}” as a new</span>
                      <select style={s.copySelect} value={copyType} disabled={busy} onChange={(e) => setCopyType(e.target.value)} aria-label="Document type to copy to">
                        {otherTypes.map((tt) => <option key={tt.value} value={tt.value}>{tt.label}</option>)}
                      </select>
                      <button type="button" style={s.copyGo} disabled={busy || !copyType}
                        onClick={() => { const target = copyType; setCopyingId(null); onCopyToType(t, target); }}>
                        <MdSwapHoriz size={15} /> Copy &amp; open
                      </button>
                      <span style={s.copyNote}>Merge fields differ per document type — adjust them after it opens.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={s.footer}>
          <span style={s.count}>{templates.length} {typeLabel} template{templates.length === 1 ? "" : "s"}</span>
          <button type="button" style={s.newBtn} disabled={busy} onClick={onNew}>
            <MdAdd size={17} /> New template…
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.78rem", color: "rgba(255,255,255,0.85)" },
  list: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  empty: { padding: "1rem 1.1rem", marginBottom: "0.75rem", color: "#5f6d7e", fontSize: "0.86rem", background: "#f7f9fc", borderRadius: 10, border: "1px dashed #d0d7e2" },
  row: {
    display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
    gap: "0.5rem", padding: "0.6rem 0.75rem", borderRadius: 10,
    border: "1px solid #e8edf3", background: "#fff", transition: "opacity 0.15s, border-color 0.15s",
  },
  rowCurrent: { borderColor: "#0d47a1", background: "#f3f7ff" },
  rowBusy: { opacity: 0.65 },
  rowMain: { display: "flex", alignItems: "center", gap: "0.5rem", flex: "1 1 220px", minWidth: 0 },
  nameBtn: {
    display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
    border: "none", background: "transparent", cursor: "pointer", padding: 0, boxShadow: "none",
    minWidth: 0, textAlign: "left", minHeight: 32, color: "inherit",
  },
  name: {
    fontSize: "0.92rem", fontWeight: 600, color: "#1a2332",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  defaultBadge: { fontSize: "0.62rem", fontWeight: 800, color: "#f57f17", background: "#fff8e1", padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  editingBadge: { fontSize: "0.62rem", fontWeight: 800, color: "#0d47a1", background: "#e3edff", padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  excelBadge: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.62rem", fontWeight: 800, color: "#1b5e20", background: "#e8f5e9", padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  renameInput: { flex: 1, minWidth: 0, padding: "0.4rem 0.55rem", fontSize: "0.9rem", border: "1px solid #0d47a1", borderRadius: 7, outline: "none", minHeight: 40 },
  // No flexShrink:0 here: on a phone the five buttons are wider than the row,
  // and a non-shrinking group would overflow the modal instead of wrapping.
  actions: { display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center", flex: "0 1 auto", minWidth: 0, maxWidth: "100%" },
  spinner: { width: 15, height: 15, borderRadius: "50%", flexShrink: 0, border: "2px solid #d0d7e2", borderTopColor: "#0d47a1", animation: "spin 0.7s linear infinite" },
  iconBtn: {
    display: "inline-flex", alignItems: "center", gap: "0.3rem",
    border: "1px solid #d0d7e2", background: "#fff", color: "#5f6d7e",
    borderRadius: 8, padding: "0 0.6rem", fontSize: "0.76rem", fontWeight: 600,
    cursor: "pointer", minHeight: 40, boxShadow: "none",
  },
  iconBtnOn: { borderColor: "#0d47a1", color: "#0d47a1", background: "#f3f7ff" },
  iconBtnDanger: { borderColor: "#ef9a9a", color: "#c62828" },
  copyRow: { flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.55rem 0.6rem", borderRadius: 8, background: "#f7f9fc", border: "1px solid #e8edf3" },
  copyHint: { fontSize: "0.82rem", color: "#1a2332", fontWeight: 600 },
  copySelect: { flex: "1 1 160px", minWidth: 0, padding: "0.4rem 0.55rem", borderRadius: 8, border: "1px solid #d0d7e2", fontSize: "0.84rem", minHeight: 40, background: "#fff" },
  copyGo: { display: "inline-flex", alignItems: "center", gap: "0.3rem", minHeight: 40, padding: "0 0.8rem", borderRadius: 8, border: "none", background: "#0d47a1", color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", boxShadow: "none" },
  copyNote: { flexBasis: "100%", fontSize: "0.74rem", color: "#5f6d7e" },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.75rem clamp(1rem, 2vw, 1.5rem)", borderTop: "1px solid #e8edf3", flexShrink: 0 },
  count: { fontSize: "0.8rem", color: "#5f6d7e", fontWeight: 600 },
  newBtn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", minHeight: 44, padding: "0 1rem", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#0d47a1,#00897b)", color: "#fff", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", boxShadow: "0 4px 14px rgba(13,71,161,0.25)" },
};
