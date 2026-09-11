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
// Renders nothing when the operator cannot list templates (no
// printtemplates.manage.view) OR the active scope has fewer than two templates
// -- with one there is nothing to choose, and the screen prints it (or the
// built-in fallback) without asking.
//
// The list has NO separate "Auto" row. Every template is listed once; the
// scope's default carries a star and is what an unpinned screen prints.
// Picking the starred one returns the screen to "follow the default", so a
// later change of default is picked up; picking any other pins it.
export default function PrintTemplateSelect({ picker, style }) {
  if (!picker?.canChoose) return null;

  // While the (shared, cached) list is still loading, show a disabled
  // "Loading templates…" control instead of a live "★ Default" with an empty
  // option list — otherwise the picker paints a bare Default first and the
  // real templates pop in a moment later (the reported "only default, then all
  // appear" flash). Once loaded it renders Auto + every in-scope template.
  if (!picker.templatesLoaded) {
    return (
      <div className="print-template-picker" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", minWidth: 0, ...style }} title="Loading print templates…">
        <MdPrint size={15} color="#9aa4b2" aria-hidden="true" />
        <select className="filter-select" aria-label="Print template (loading)" disabled value="" style={{ flex: 1, minWidth: 0, maxWidth: 260, opacity: 0.7 }}>
          <option value="">Loading templates…</option>
        </select>
      </div>
    );
  }

  const autoDefault = picker.resolveAuto();
  const autoId = autoDefault ? String(autoDefault.id) : "";
  // An unpinned screen shows the default as selected; pinning the default
  // itself is the same thing as not pinning, so it is stored as "" (follow).
  const value = picker.selectedId || autoId;
  const onChange = (e) => picker.setSelectedId(e.target.value === autoId ? "" : e.target.value);
  const following = !picker.selectedId;

  return (
    <div className="print-template-picker" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", minWidth: 0, ...style }}
         title={following ? "Print template: following the default for this scope" : "Print template pinned for this screen"}>
      <MdPrint size={15} color="#5f6d7e" aria-hidden="true" />
      <select
        className="filter-select"
        aria-label="Print template"
        value={value}
        onChange={onChange}
        style={{ flex: 1, minWidth: 0, maxWidth: 260 }}
      >
        {picker.templates.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {String(t.id) === autoId ? `★ ${t.name} (default)` : t.name}
          </option>
        ))}
      </select>
    </div>
  );
}
