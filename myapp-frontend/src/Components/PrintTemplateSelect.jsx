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

  const autoDefault = picker.resolveAuto();
  const autoLabel = autoDefault ? `Default — ${autoDefault.name}` : "Default";

  return (
    <div className="print-template-picker" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", minWidth: 0, ...style }} title="Print template used by Print / PDF">
      <MdPrint size={15} color="#5f6d7e" aria-hidden="true" />
      <select
        className="filter-select"
        aria-label="Print template"
        value={picker.selectedId}
        onChange={(e) => picker.setSelectedId(e.target.value)}
        style={{ flex: 1, minWidth: 0, maxWidth: 260 }}
      >
        <option value="">{`★ ${autoLabel}`}</option>
        {picker.templates.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.name}
            {t.isDefault ? " ★" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
