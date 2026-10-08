import { useEffect, useMemo, useState } from "react";
import {
  MdClose, MdDescription, MdContentCopy, MdAutoAwesome, MdCheckCircle, MdArrowDropDown,
} from "react-icons/md";
import { formStyles, modalSizes } from "../../theme";
import { TEMPLATE_TYPES, TEMPLATE_TYPE_LABEL, DEFAULT_TEMPLATES } from "../../utils/templateSampleData";
import { createTemplate, getTemplateById } from "../../api/printTemplateApi";
import StarterGallery from "./StarterGallery";
import { Button } from "../../ui/Kit";

/**
 * A name no other template of the company already uses. "Bill / Invoice" when
 * that is free, otherwise "Bill / Invoice 2", "… 3" — so two templates never
 * come out identically named and the operator is never asked to type a name
 * before they can save.
 */
export function uniqueTemplateName(base, templates) {
  const taken = new Set((templates || []).map((t) => (t.name || "").trim().toLowerCase()));
  const root = (base || "Template").trim();
  if (!taken.has(root.toLowerCase())) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${root} ${Date.now()}`;
}

/**
 * One dialog for making a template: pick the document type, name it, and say
 * what it starts from — the built-in default, a copy of one of the company's
 * own templates of that type, or a starter design. Create writes the row
 * straight away and hands the DTO back, so the editor always opens on a saved
 * template and Save / Set default / signature all work from the first second.
 *
 * Props:
 *   companyId      — owner of the new template
 *   templates      — every template of the company (unique names + copy sources)
 *   initialType    — preselected document type (the page's filter, or the
 *                    editor's current type); falls back to Challan
 *   initialStarter — open with a starter already chosen (Starter tab hand-off)
 *   onCreated(dto) — called with the created template
 *   onClose()
 */
export default function NewTemplateDialog({
  companyId, templates = [], initialType = "", initialStarter = null, onCreated, onClose,
}) {
  const [type, setType] = useState(
    TEMPLATE_TYPES.some((t) => t.value === initialType) ? initialType : (initialStarter?.type || "Challan"));
  const [source, setSource] = useState(initialStarter ? "starter" : "blank"); // blank | copy | starter
  const [copyId, setCopyId] = useState("");
  const [starter, setStarter] = useState(initialStarter);
  const [showGallery, setShowGallery] = useState(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ofType = useMemo(
    () => templates.filter((t) => t.templateType === type).sort((a, b) => (b.isDefault - a.isDefault) || a.id - b.id),
    [templates, type]
  );
  const copySource = ofType.find((t) => String(t.id) === String(copyId)) || null;

  // The suggested name follows the choices until the operator types one of
  // their own; after that it is theirs and nothing here overwrites it.
  useEffect(() => {
    if (nameTouched) return;
    const base = source === "starter" && starter ? starter.name
      : source === "copy" && copySource ? `${copySource.name} (copy)`
      : (TEMPLATE_TYPE_LABEL[type] || type);
    setName(uniqueTemplateName(base, templates));
  }, [type, source, starter, copySource, templates, nameTouched]);

  // Switching type invalidates a copy source or a starter of the old type.
  const changeType = (next) => {
    setType(next);
    setCopyId("");
    if (starter && starter.type !== next) { setStarter(null); if (source === "starter") setSource("blank"); }
    if (source === "copy") setSource("blank");
  };

  const canCreate = !busy && name.trim().length > 0
    && (source !== "copy" || !!copySource)
    && (source !== "starter" || !!starter);

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    try {
      let body = { htmlContent: DEFAULT_TEMPLATES[type] || "", templateJson: null, editorMode: "code", stampId: null };
      if (source === "copy" && copySource) {
        // The list may carry the body already, but the saved row is the truth —
        // a copy must never start from a stale or partial body.
        const { data: full } = await getTemplateById(copySource.id);
        body = { htmlContent: full.htmlContent || "", templateJson: full.templateJson || null,
                 editorMode: full.editorMode || "code", stampId: full.stampId ?? null };
      } else if (source === "starter" && starter) {
        body = { htmlContent: starter.html, templateJson: null, editorMode: "code", stampId: null };
      }
      const { data } = await createTemplate(companyId, {
        templateType: type, name: name.trim(), isDefault: false, ...body,
      });
      onCreated?.(data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not create the template. Please try again.");
      setBusy(false);
    }
  };

  const typeLabel = TEMPLATE_TYPE_LABEL[type] || type;

  return (
    <>
      <div data-admin-backdrop="" style={formStyles.backdrop} onClick={busy ? undefined : onClose}>
        <div data-admin-dialog="" style={{ ...formStyles.modal, maxWidth: `${modalSizes.md}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-tpl-title">
          <div style={formStyles.header}>
            <h3 id="new-tpl-title" style={formStyles.title}>New Template</h3>
            <button data-admin-close="" type="button" style={formStyles.closeButton} onClick={onClose} disabled={busy} aria-label="Close"><MdClose size={20} /></button>
          </div>

          <div style={formStyles.body}>
            <div style={s.grid}>
              <label style={s.field}>
                <span style={s.label}>Document type</span>
                <select className="k-select" value={type} onChange={(e) => changeType(e.target.value)} disabled={busy}>
                  {TEMPLATE_TYPES.map((t) => {
                    const n = templates.filter((x) => x.templateType === t.value).length;
                    return <option key={t.value} value={t.value}>{t.label}{n ? ` (${n})` : ""}</option>;
                  })}
                </select>
              </label>
              <label style={s.field}>
                <span style={s.label}>Name</span>
                <input
                  className="k-input" value={name} maxLength={120} disabled={busy}
                  onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
                  onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                  placeholder={`e.g. ${typeLabel} — Letterhead`}
                />
              </label>
            </div>

            <div style={s.label}>Start from</div>
            <div style={s.options} role="radiogroup" aria-label="Start from">
              <OptionCard
                active={source === "blank"} disabled={busy} onClick={() => setSource("blank")}
                icon={<MdDescription size={20} />} title="Built-in default"
                hint={`The standard ${typeLabel} layout — a clean page to shape into your own.`}
              />
              <OptionCard
                active={source === "copy"} disabled={busy || ofType.length === 0} onClick={() => setSource("copy")}
                icon={<MdContentCopy size={20} />} title="Copy of an existing template"
                hint={ofType.length === 0
                  ? `No ${typeLabel} template to copy yet.`
                  : `Start from one of your ${ofType.length} ${typeLabel} template${ofType.length === 1 ? "" : "s"}; the signature comes along.`}
              >
                {source === "copy" && (
                  <select className="k-select" style={{ marginTop: "0.5rem" }} value={copyId} disabled={busy}
                    onChange={(e) => setCopyId(e.target.value)} onClick={(e) => e.stopPropagation()}>
                    <option value="">Choose a template…</option>
                    {ofType.map((t) => <option key={t.id} value={t.id}>{t.isDefault ? `★ ${t.name}` : t.name}</option>)}
                  </select>
                )}
              </OptionCard>
              <OptionCard
                active={source === "starter"} disabled={busy}
                onClick={() => { setSource("starter"); if (!starter) setShowGallery(true); }}
                icon={<MdAutoAwesome size={20} />} title="A starter design"
                hint={starter ? `Using “${starter.name}”.` : "Pick one of the designed layouts for this document type."}
              >
                {source === "starter" && (
                  <Button size="sm" icon={MdAutoAwesome} style={{ marginTop: "0.5rem" }} disabled={busy} onClick={(e) => { e.stopPropagation(); setShowGallery(true); }}>
                    {starter ? "Choose a different design" : "Browse designs"} <MdArrowDropDown size={18} aria-hidden="true" />
                  </Button>
                )}
              </OptionCard>
            </div>

            {error && <div style={formStyles.error} role="alert">{error}</div>}
          </div>

          <div style={formStyles.footer}>
            <button data-admin-close="" type="button" style={{ ...formStyles.button, ...formStyles.cancel }} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" style={{ ...formStyles.button, ...formStyles.submit, ...s.btnInline, ...(canCreate ? {} : s.btnDisabled) }} onClick={create} disabled={!canCreate}>
              {busy ? <><span style={s.spin} /> Creating…</> : <><MdCheckCircle size={17} /> Create &amp; open</>}
            </button>
          </div>
        </div>
      </div>

      {showGallery && (
        <StarterGallery
          lockType={type}
          selectLabel="Choose this"
          onSelect={(st) => { setStarter(st); setSource("starter"); setShowGallery(false); }}
          onClose={() => { setShowGallery(false); if (!starter) setSource("blank"); }}
        />
      )}
    </>
  );
}

function OptionCard({ active, disabled, onClick, icon, title, hint, children }) {
  return (
    <div
      role="radio" aria-checked={active} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      style={{ ...s.option, ...(active ? s.optionActive : {}), ...(disabled ? s.optionDisabled : {}) }}
    >
      <span style={{ ...s.optionIcon, ...(active ? s.optionIconActive : {}) }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.optionTitle}>{title}</div>
        <div style={s.optionHint}>{hint}</div>
        {children}
      </div>
      <span style={{ ...s.radio, ...(active ? s.radioActive : {}) }} aria-hidden="true">{active && <span style={s.radioDot} />}</span>
    </div>
  );
}

// Option cards (radio group) are dialog-specific; colours and sizes read the
// kit tokens (--k-*) so the dialog follows the selected theme.
const s = {
  grid: { display: "grid", gap: "0.85rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", marginBottom: "1rem" },
  field: { display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 0 },
  label: { fontSize: "0.72rem", fontWeight: 700, color: "var(--k-muted)", textTransform: "uppercase", letterSpacing: "0.04em" },
  options: { display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.4rem" },
  option: { display: "flex", alignItems: "flex-start", gap: "0.7rem", padding: "0.7rem 0.8rem", borderRadius: "var(--k-radius)", border: "1px solid var(--k-line-strong)", background: "var(--k-surface)", cursor: "pointer", minHeight: 44, outline: "none" },
  optionActive: { borderColor: "var(--k-blue)", background: "#f3f7ff", boxShadow: "0 0 0 2px rgba(13,71,161,0.12)" },
  optionDisabled: { opacity: 0.55, cursor: "not-allowed" },
  optionIcon: { display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: "calc(var(--k-radius) - 1px)", background: "var(--k-surface-3)", color: "var(--k-muted)", flexShrink: 0 },
  optionIconActive: { background: "var(--k-blue)", color: "#fff" },
  optionTitle: { fontSize: "var(--k-font)", fontWeight: 700, color: "var(--k-ink)" },
  optionHint: { fontSize: "var(--k-font-sm)", color: "var(--k-muted)", marginTop: 2, lineHeight: 1.35 },
  radio: { width: 20, height: 20, borderRadius: "50%", border: "2px solid #c2cad6", display: "grid", placeItems: "center", flexShrink: 0, marginTop: 2 },
  radioActive: { borderColor: "var(--k-blue)" },
  radioDot: { width: 10, height: 10, borderRadius: "50%", background: "var(--k-blue)" },
  btnInline: { display: "inline-flex", alignItems: "center", gap: "0.4rem" },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed", boxShadow: "none" },
  spin: { width: 15, height: 15, borderRadius: "50%", display: "inline-block", border: "2px solid rgba(255,255,255,0.45)", borderTopColor: "#fff", animation: "k-spin 0.7s linear infinite" },
};
