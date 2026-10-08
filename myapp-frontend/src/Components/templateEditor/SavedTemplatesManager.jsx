import { useRef, useState } from "react";
import {
  MdClose, MdStar, MdStarBorder, MdContentCopy, MdEdit, MdDelete, MdCheck, MdAdd,
  MdSwapHoriz, MdGridOn, MdOpenInNew,
} from "react-icons/md";
import { formStyles, modalSizes } from "../../theme";
import { TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL } from "../../utils/templateSampleData";
import { Button } from "../../ui/Kit";

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
    <div data-admin-backdrop="" style={formStyles.backdrop} onClick={busy ? undefined : onClose}>
      <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.lg}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="tpl-mgr-title">
        <div style={formStyles.header}>
          <div>
            <h3 id="tpl-mgr-title" style={formStyles.title}>{typeLabel} templates</h3>
            <p style={s.subtitle}>The default (★) is what this document type prints with unless a screen picks another.</p>
          </div>
          <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} disabled={busy} aria-label="Close"><MdClose size={20} /></button>
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
                        className="k-input"
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
                    {rowBusy && <span className="k-spinner" style={s.spinner} aria-label="Working…" />}
                    {!isCurrent && (
                      <Button size="sm" icon={MdOpenInNew} disabled={busy} onClick={() => onSelect(t.id)} title="Open in the editor">
                        Open
                      </Button>
                    )}
                    {!t.isDefault && (
                      <Button size="sm" icon={MdCheck} disabled={busy} onClick={() => onSetDefault(t.id)} title="Use this template for printing">
                        Set default
                      </Button>
                    )}
                    <Button size="sm" icon={MdEdit} disabled={busy} onClick={() => startRename(t)} title="Rename">
                      Rename
                    </Button>
                    <Button size="sm" icon={MdContentCopy} disabled={busy} onClick={() => onDuplicate(t)} title="Duplicate (same document type)">
                      Duplicate
                    </Button>
                    {otherTypes.length > 0 && (
                      <Button size="sm" icon={MdSwapHoriz} style={copyingId === t.id ? s.btnOn : undefined} disabled={busy}
                        aria-pressed={copyingId === t.id}
                        onClick={() => (copyingId === t.id ? setCopyingId(null) : startCopy(t))}
                        title="Reuse this design for another document type">
                        Copy to…
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="danger" size="sm" icon={MdDelete} disabled={busy} onClick={() => onDelete(t)} title="Delete">
                        Delete
                      </Button>
                    )}
                  </div>

                  {copyingId === t.id && (
                    <div style={s.copyRow}>
                      <span style={s.copyHint}>Copy “{t.name}” as a new</span>
                      <select className="k-select" style={s.copySelect} value={copyType} disabled={busy} onChange={(e) => setCopyType(e.target.value)} aria-label="Document type to copy to">
                        {otherTypes.map((tt) => <option key={tt.value} value={tt.value}>{tt.label}</option>)}
                      </select>
                      <Button variant="primary" size="sm" icon={MdSwapHoriz} disabled={busy || !copyType}
                        onClick={() => { const target = copyType; setCopyingId(null); onCopyToType(t, target); }}>
                        Copy &amp; open
                      </Button>
                      <span style={s.copyNote}>Merge fields differ per document type — adjust them after it opens.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ ...formStyles.footer, justifyContent: "space-between", alignItems: "center" }}>
          <span style={s.count}>{templates.length} {typeLabel} template{templates.length === 1 ? "" : "s"}</span>
          <button type="button" style={{ ...formStyles.button, ...formStyles.submit, display: "inline-flex", alignItems: "center", gap: "0.35rem" }} disabled={busy} onClick={onNew}>
            <MdAdd size={17} /> New template…
          </button>
        </div>
      </div>
    </div>
  );
}

// Layout + badges are page-specific; surfaces, borders and text read the kit
// tokens (--k-*) so the dialog body follows the selected theme.
const s = {
  subtitle: { margin: "0.15rem 0 0", fontSize: "0.78rem", color: "var(--ui-modal-title-color, #ffffff)", opacity: 0.85 },
  list: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  empty: { padding: "1rem 1.1rem", marginBottom: "0.75rem", color: "var(--k-muted)", fontSize: "var(--k-font)", background: "var(--k-surface-2)", borderRadius: "var(--k-radius)", border: "1px dashed var(--k-line-strong)" },
  row: {
    display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between",
    gap: "0.5rem", padding: "0.6rem 0.75rem", borderRadius: "var(--k-radius)",
    border: "1px solid var(--k-line)", background: "var(--k-surface)", transition: "opacity 0.15s, border-color 0.15s",
  },
  rowCurrent: { borderColor: "var(--k-blue)", background: "#f3f7ff" },
  rowBusy: { opacity: 0.65 },
  rowMain: { display: "flex", alignItems: "center", gap: "0.5rem", flex: "1 1 220px", minWidth: 0 },
  nameBtn: {
    display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap",
    border: "none", background: "transparent", cursor: "pointer", padding: 0, boxShadow: "none",
    minWidth: 0, textAlign: "left", minHeight: 32, color: "inherit",
  },
  name: {
    fontSize: "var(--k-font)", fontWeight: 600, color: "var(--k-ink)",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  defaultBadge: { fontSize: "0.62rem", fontWeight: 800, color: "#f57f17", background: "#fff8e1", padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  editingBadge: { fontSize: "0.62rem", fontWeight: 800, color: "#0d47a1", background: "#e3edff", padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  excelBadge: { display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.62rem", fontWeight: 800, color: "#1b5e20", background: "#e8f5e9", padding: "1px 6px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0 },
  renameInput: { flex: 1, minWidth: 0, width: "auto", borderColor: "var(--k-blue)" },
  // No flexShrink:0 here: on a phone the five buttons are wider than the row,
  // and a non-shrinking group would overflow the modal instead of wrapping.
  actions: { display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center", flex: "0 1 auto", minWidth: 0, maxWidth: "100%" },
  spinner: { width: 15, height: 15, borderWidth: 2, flexShrink: 0 },
  // "Copy to…" while its row is open.
  btnOn: { borderColor: "var(--k-blue)", background: "#f3f7ff" },
  copyRow: { flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.55rem 0.6rem", borderRadius: "var(--k-radius)", background: "var(--k-surface-2)", border: "1px solid var(--k-line)" },
  copyHint: { fontSize: "var(--k-font-sm)", color: "var(--k-ink)", fontWeight: 600 },
  copySelect: { flex: "1 1 160px", minWidth: 0, width: "auto" },
  copyNote: { flexBasis: "100%", fontSize: "0.74rem", color: "var(--k-muted)" },
  count: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)", fontWeight: 600 },
};
