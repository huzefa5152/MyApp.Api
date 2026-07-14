import { MdPrint } from "react-icons/md";

// Generic print-template dropdown for document screens. Pair it with
// usePrintTemplates — the page owns the hook instance (so Print/PDF handlers
// and this dropdown share one state) and passes it in as `picker`:
//
//   const picker = usePrintTemplates("SalesOrder", { divisionId: divisionFilter });
//   <PrintTemplateSelect picker={picker} />
//   ...
//   const tpl = picker.resolveTemplate(doc)?.htmlContent || builtInDefault;
//
// The dropdown lists ONLY the templates in the screen's current division scope
// (see usePrintTemplates): company-wide templates when "All Divisions" is
// selected, or that division's templates for a specific division.
//
// Renders nothing when the operator can't list templates (no
// printtemplates.manage.view) OR the active scope has no template — in the
// latter case the screen also blocks Print/PDF (picker.noTemplate), so we
// never offer a picker that can't resolve to a valid template.
export default function PrintTemplateSelect({ picker, style }) {
  if (!picker?.canChoose) return null;

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
