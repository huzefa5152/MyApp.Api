import { MdPrint } from "react-icons/md";

// Generic print-template dropdown for document screens. Pair it with
// usePrintTemplates — the page owns the hook instance (so Print/PDF handlers
// and this dropdown share one state) and passes it in as `picker`:
//
//   const picker = usePrintTemplates("SalesOrder");
//   <PrintTemplateSelect picker={picker} />
//   ...
//   const tpl = picker.resolveTemplate(doc)?.htmlContent || builtInDefault;
//
// Renders nothing when the operator can't list templates (no
// printtemplates.manage.view) or the company has none of this type —
// printing then falls back to the default exactly as before.
export default function PrintTemplateSelect({ picker, style }) {
  if (!picker?.canChoose) return null;

  // On divisionAware screens (Sales Quotes) the default is resolved PER
  // DOCUMENT — a division quote uses its division's default, not the
  // company one — so naming a single company template here would mislead.
  // Show a scope-neutral label instead. Elsewhere the default is a single
  // company-level template, so name it.
  const autoDefault = picker.resolveAuto(null);
  const autoLabel = picker.divisionAware
    ? "Default (per division)"
    : autoDefault ? `Default — ${autoDefault.name}` : "Default";

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
            {t.divisionName ? ` (${t.divisionName})` : ""}
            {t.isDefault ? " ★" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
