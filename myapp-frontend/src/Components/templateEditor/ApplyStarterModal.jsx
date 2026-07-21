import { useState } from "react";
import { MdClose, MdArrowBack, MdWarningAmber, MdCheckCircle } from "react-icons/md";
import StarterGallery from "./StarterGallery";
import PreviewPane from "./PreviewPane";
import { buildTemplatePreviewHtml, TEMPLATE_TYPE_LABEL } from "../../utils/templateSampleData";
import { applyStarterToTemplate } from "../../api/printTemplateApi";
import { useCompany } from "../../contexts/CompanyContext";
import { notify } from "../../utils/notify";

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
  const { selectedCompany } = useCompany();
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
  const currentHtml = buildTemplatePreviewHtml(template.templateType, template.htmlContent || "", brand);
  const starterHtml = buildTemplatePreviewHtml(starter.type, starter.html, brand);

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
    <div style={s.overlay}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <div style={{ minWidth: 0 }}>
            <h3 style={s.title}>Apply starter to “{template.name}”</h3>
            <p style={s.subtitle}>
              {TEMPLATE_TYPE_LABEL[template.templateType] || template.templateType} · Starter: <strong>{starter.name}</strong>
            </p>
          </div>
          <button style={s.closeBtn} onClick={onClose} aria-label="Close"><MdClose size={22} /></button>
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
          <div style={{ ...s.compareCol, borderLeft: "2px solid #d0d7e2" }}><PreviewPane html={starterHtml} isMobile={false} /></div>
        </div>

        <div style={s.footer}>
          <div style={s.warn}><MdWarningAmber size={16} /> This overwrites the current design and is recorded in the audit log. It cannot be undone from here.</div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button style={s.backBtn} onClick={() => setStarter(null)} disabled={busy}><MdArrowBack size={16} /> Choose another</button>
            <button style={s.applyBtn} onClick={apply} disabled={busy}>
              <MdCheckCircle size={16} /> {busy ? "Applying…" : (mode === "all" ? "Replace everything" : "Replace HTML")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1250, padding: "1rem" },
  modal: { background: "#fff", borderRadius: 16, width: "min(1000px, 96vw)", maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid #eef1f6" },
  title: { margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#1a2332", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  subtitle: { margin: "0.2rem 0 0", fontSize: "0.82rem", color: "#5f6d7e" },
  closeBtn: { border: "none", background: "transparent", cursor: "pointer", color: "#8a94a6", padding: 4, borderRadius: 8, display: "inline-flex", flexShrink: 0 },
  modes: { display: "grid", gap: "0.6rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", padding: "0.9rem 1.25rem" },
  mode: { display: "flex", gap: "0.6rem", alignItems: "flex-start", border: "1px solid #d8dee8", borderRadius: 10, padding: "0.7rem 0.85rem", cursor: "pointer", background: "#fff" },
  modeActive: { borderColor: "#0d47a1", background: "#f3f7ff", boxShadow: "0 0 0 1px #0d47a1 inset" },
  modeTitle: { fontSize: "0.9rem", fontWeight: 700, color: "#1a2332", display: "flex", alignItems: "center", gap: "0.4rem" },
  modeDesc: { fontSize: "0.76rem", color: "#5f6d7e", marginTop: "0.2rem", lineHeight: 1.35 },
  rec: { fontSize: "0.6rem", fontWeight: 800, color: "#1b5e20", background: "#e8f5e9", padding: "1px 6px", borderRadius: 5, textTransform: "uppercase", letterSpacing: "0.4px" },
  compareBar: { display: "grid", gridTemplateColumns: "1fr 1fr", padding: "0 1.25rem" },
  compareLabel: { fontSize: "0.72rem", fontWeight: 800, color: "#5f6d7e", textTransform: "uppercase", letterSpacing: "0.5px", padding: "0.35rem 0" },
  compare: { display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, minHeight: 260, overflow: "hidden", borderTop: "1px solid #eef1f6", background: "#e8e8e8" },
  compareCol: { display: "flex", flexDirection: "column", overflow: "hidden" },
  footer: { display: "flex", flexWrap: "wrap", gap: "0.6rem", justifyContent: "space-between", alignItems: "center", padding: "0.8rem 1.25rem", borderTop: "1px solid #eef1f6" },
  warn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.76rem", color: "#8a6d1a", flex: "1 1 240px" },
  backBtn: { display: "inline-flex", alignItems: "center", gap: "0.3rem", border: "1px solid #d0d7e2", background: "#fff", color: "#5f6d7e", borderRadius: 9, padding: "0.5rem 0.85rem", fontSize: "0.84rem", fontWeight: 700, cursor: "pointer" },
  applyBtn: { display: "inline-flex", alignItems: "center", gap: "0.35rem", border: "none", background: "#0d47a1", color: "#fff", borderRadius: 9, padding: "0.5rem 1rem", fontSize: "0.84rem", fontWeight: 700, cursor: "pointer" },
};
