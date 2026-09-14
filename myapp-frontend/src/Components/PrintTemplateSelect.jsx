import { MdPrint, MdErrorOutline } from "react-icons/md";

// Generic print-template dropdown for document screens. Pair it with
// usePrintTemplates — the page owns the hook instance (so Print/PDF handlers
// and this dropdown share one state) and passes it in as `picker`:
//
//   const picker = usePrintTemplates("SalesOrder");
//   <PrintTemplateSelect picker={picker} />
//   ...
//   const tpl = picker.resolveTemplate(doc)?.htmlContent || builtInDefault;
//
// States:
// - Operator can't view templates (print-only role) → render nothing; the
//   screen keeps its built-in fallback so they aren't locked out.
// - Operator CAN view templates but NONE is configured for this type
//   (picker.noTemplate) → render a DISABLED hint with a tooltip explaining why,
//   and the screen disables Print/PDF too.
// - Templates exist → the switchable dropdown.
export default function PrintTemplateSelect({ picker, style }) {
  if (!picker) return null;

  // No template configured for this document type → disabled hint + tooltip.
  if (picker.noTemplate) {
    return (
      <div
        className="print-template-picker"
        title={picker.noTemplateReason}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", minWidth: 0, opacity: 0.75, cursor: "not-allowed", ...style }}
      >
        <MdErrorOutline size={15} color="#c62828" aria-hidden="true" />
        <select className="filter-select" aria-label="Print template" disabled value="" style={{ flex: 1, minWidth: 0, maxWidth: 260, cursor: "not-allowed" }}>
          <option value="">No print template configured</option>
        </select>
      </div>
    );
  }

  if (!picker.canChoose) return null; // print-only role — keeps built-in fallback

  const autoDefault = picker.resolveAuto();       // the default (or oldest) template
  const templates = picker.templates;

  // Single template → there is no choice to make. Show the default's name as a
  // plain label, NOT a two-row dropdown (the old code listed the default as
  // both "★ Default — X" and "X ★", which read as two templates for one).
  if (templates.length <= 1) {
    const only = templates[0] || autoDefault;
    return (
      <div
        className="print-template-picker"
        style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", minWidth: 0, ...style }}
        title="Default print template used by Print / PDF"
      >
        <MdPrint size={15} color="#5f6d7e" aria-hidden="true" />
        <span
          style={{ fontSize: "0.85rem", color: "#334e68", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {only ? only.name : "Default"}
        </span>
      </div>
    );
  }

  // Multiple templates → the default is the "Default — X" auto row; list only the
  // OTHER templates so the default never appears twice. A stored pick that IS the
  // default collapses back to the auto row.
  const others = templates.filter((t) => !autoDefault || t.id !== autoDefault.id);
  const effectiveValue =
    autoDefault && picker.selectedId === String(autoDefault.id) ? "" : picker.selectedId;

  return (
    <div className="print-template-picker" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", minWidth: 0, ...style }} title="Print template used by Print / PDF — override per document type here">
      <MdPrint size={15} color="#5f6d7e" aria-hidden="true" />
      <select
        className="filter-select"
        aria-label="Print template"
        value={effectiveValue}
        onChange={(e) => picker.setSelectedId(e.target.value)}
        style={{ flex: 1, minWidth: 0, maxWidth: 260 }}
      >
        <option value="">{`★ Default — ${autoDefault ? autoDefault.name : ""}`}</option>
        {others.map((t) => (
          <option key={t.id} value={String(t.id)}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}
