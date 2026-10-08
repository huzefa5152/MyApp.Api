import { useState } from "react";
import { MdClose, MdArrowBack, MdWarningAmber, MdCheckCircle } from "react-icons/md";
import StarterGallery from "./StarterGallery";
import PreviewPane from "./PreviewPane";
import { buildTemplatePreviewHtml, TEMPLATE_TYPE_LABEL } from "../../utils/templateSampleData";
import { applyStarterToTemplate } from "../../api/printTemplateApi";
import { useCompany } from "../../contexts/CompanyContext";
import { materializeStamp } from "../../utils/stampSlot";
import { notify } from "../../utils/notify";
import { formStyles } from "../../theme";

/**
 * Apply a starter design onto an EXISTING template (never creates a new one).
 * Step 1: pick a starter (gallery, locked to the template's document type).
 * Step 2: choose how to apply it and confirm against a side-by-side preview:
 *   • Replace HTML only  — swaps the body HTML, preserves name / settings /
 *     default status / metadata (recommended).
 *   • Replace everything — also discards the visual-editor layout so the
 *     starter's design fully replaces the current one.
 * The template id, default flag and audit history are always kept.
 *
 * Props: template (DTO: id, name, templateType, htmlContent), onClose(),
 *        onApplied(updatedDto).
 */
export default function ApplyStarterModal({ template, onClose, onApplied }) {
  const { selectedCompany, companyStamps } = useCompany();
  const [starter, setStarter] = useState(null);
  const [mode, setMode] = useState("html"); // "html" | "all"
  const [busy, setBusy] = useState(false);

  // Step 1 — gallery, filtered to this template's document type.
  if (!starter) {
    return (
      <StarterGallery
        lockType={template.templateType}
        selectLabel="Choose this"
        onSelect={setStarter}
        onClose={onClose}
      />
    );
  }

  const brand = { company: selectedCompany };
  // Applying a starter replaces the HTML but keeps the stamp assignment, so
  // BOTH panes must render this template's signature — otherwise the "after"
  // preview shows an unsigned document that will actually print signed.
  const stampUrl = companyStamps.find((s) => s.id === template.stampId)?.url || null;
  const currentHtml = buildTemplatePreviewHtml(
    template.templateType, materializeStamp(template.htmlContent || "", stampUrl), brand);
  const starterHtml = buildTemplatePreviewHtml(
    starter.type, materializeStamp(starter.html, stampUrl), brand);

  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await applyStarterToTemplate(template.id, {
        htmlContent: starter.html,
        mode,
        starterName: starter.name,
      });
      notify(`Applied "${starter.name}" to ${template.name}.`, "success");
      onApplied?.(data);
    } catch (err) {
      notify(err.response?.data?.error || "Failed to apply starter.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-admin-backdrop="" style={s.overlay}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="apply-starter-title">
        <div style={{ ...formStyles.header, alignItems: "flex-start", gap: "0.75rem" }}>
          <div style={{ minWidth: 0 }}>
            <h3 id="apply-starter-title" style={{ ...formStyles.title, ...s.titleClamp }}>Apply starter to “{template.name}”</h3>
            <p style={s.subtitle}>
              {TEMPLATE_TYPE_LABEL[template.templateType] || template.templateType} · Starter: <strong>{starter.name}</strong>
            </p>
          </div>
          <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} aria-label="Close"><MdClose size={22} /></button>
        </div>

        {/* Mode choice */}
        <div style={s.modes}>
          <label style={{ ...s.mode, ...(mode === "html" ? s.modeActive : {}) }}>
            <input type="radio" name="applymode" checked={mode === "html"} onChange={() => setMode("html")} />
            <div>
              <div style={s.modeTitle}>Replace HTML only <span style={s.rec}>Recommended</span></div>
              <div style={s.modeDesc}>Swap the body design. Keeps the template name, default status, Excel layout and all settings.</div>
            </div>
          </label>
          <label style={{ ...s.mode, ...(mode === "all" ? s.modeActive : {}) }}>
            <input type="radio" name="applymode" checked={mode === "all"} onChange={() => setMode("all")} />
            <div>
              <div style={s.modeTitle}>Replace everything</div>
              <div style={s.modeDesc}>Also discards the visual-editor layout so the starter fully replaces the current design. Name, default &amp; history are still kept.</div>
            </div>
          </label>
        </div>

        {/* Side-by-side comparison */}
        <div style={s.compareBar}>
          <span style={s.compareLabel}>Current</span>
          <span style={s.compareLabel}>Starter “{starter.name}”</span>
        </div>
        <div style={s.compare}>
          <div style={s.compareCol}><PreviewPane html={currentHtml} isMobile={false} /></div>
          <div style={{ ...s.compareCol, borderLeft: "2px solid var(--k-line-strong)" }}><PreviewPane html={starterHtml} isMobile={false} /></div>
        </div>

        <div style={{ ...formStyles.footer, justifyContent: "space-between", alignItems: "center" }}>
          <div style={s.warn}><MdWarningAmber size={16} /> This overwrites the current design and is recorded in the audit log. It cannot be undone from here.</div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" style={{ ...formStyles.button, ...formStyles.cancel, ...s.btnInline }} onClick={() => setStarter(null)} disabled={busy}><MdArrowBack size={16} /> Choose another</button>
            <button type="button" style={{ ...formStyles.button, ...formStyles.submit, ...s.btnInline }} onClick={apply} disabled={busy}>
              <MdCheckCircle size={16} /> {busy ? "Applying…" : (mode === "all" ? "Replace everything" : "Replace HTML")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Dialog chrome comes from the shared formStyles (themed); the mode cards and
// the side-by-side comparison are dialog-specific and read the --k-* tokens.
// The preview panes themselves (PreviewPane) are document content — untouched.
const s = {
  overlay: { ...formStyles.backdrop, zIndex: 1250 },
  modal: { ...formStyles.modal, maxWidth: 1000, maxHeight: "94vh" },
  // Template names are operator-supplied: clamp to two lines, never nowrap+ellipsis.
  titleClamp: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" },
  subtitle: { margin: "0.2rem 0 0", fontSize: "var(--k-font-sm)", color: "var(--ui-modal-title-color, #ffffff)", opacity: 0.85 },
  modes: { display: "grid", gap: "0.6rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", padding: "0.9rem 1.25rem", flexShrink: 0 },
  mode: { display: "flex", gap: "0.6rem", alignItems: "flex-start", border: "1px solid var(--k-line-strong)", borderRadius: "var(--k-radius)", padding: "0.7rem 0.85rem", cursor: "pointer", background: "var(--k-surface)" },
  modeActive: { borderColor: "var(--k-blue)", background: "#f3f7ff", boxShadow: "0 0 0 1px var(--k-blue) inset" },
  modeTitle: { fontSize: "var(--k-font)", fontWeight: 700, color: "var(--k-ink)", display: "flex", alignItems: "center", gap: "0.4rem" },
  modeDesc: { fontSize: "0.76rem", color: "var(--k-muted)", marginTop: "0.2rem", lineHeight: 1.35 },
  rec: { fontSize: "0.6rem", fontWeight: 800, color: "#1b5e20", background: "#e8f5e9", padding: "1px 6px", borderRadius: 5, textTransform: "uppercase", letterSpacing: "0.4px" },
  compareBar: { display: "grid", gridTemplateColumns: "1fr 1fr", padding: "0 1.25rem", flexShrink: 0 },
  compareLabel: { fontSize: "0.72rem", fontWeight: 800, color: "var(--k-muted)", textTransform: "uppercase", letterSpacing: "0.5px", padding: "0.35rem 0" },
  compare: { display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 260, overflow: "hidden", borderTop: "1px solid var(--k-line)", background: "#e8e8e8" },
  compareCol: { display: "flex", flexDirection: "column", overflow: "hidden" },
  warn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.76rem", color: "#8a6d1a", flex: "1 1 240px" },
  btnInline: { display: "inline-flex", alignItems: "center", gap: "0.35rem" },
};
