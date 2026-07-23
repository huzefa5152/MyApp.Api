import { useCallback, useEffect, useMemo, useState } from "react";
import { getTemplatesByCompany } from "../api/printTemplateApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";

// Generic per-document-type print-template picker state, shared by every
// document screen (quotes, orders, challans, bills, tax invoices, notes,
// purchase bills, goods receipts).
//
// Selection semantics:
// - selectedId "" = "Auto (default)" — resolves to the type's default-flagged
//   template, else the oldest (lowest id) template.
// - A non-empty selectedId pins an explicit template: Print/PDF then use it for
//   every document printed from the screen.
// - The choice persists per (company, templateType) in localStorage and is
//   restored on the next visit; a pick that no longer exists (template deleted)
//   silently resets to Auto once the list loads.
// - Loading the list requires printtemplates.manage.view. Without it, templates
//   stay empty, the picker hides, and `noTemplate` stays false so print-only
//   roles keep the built-in fallback template rather than being locked out
//   (we can't scope what we can't read).
const storageKey = (companyId, templateType) => `printTpl:${companyId}:${templateType}`;

const readStored = (companyId, templateType) => {
  if (!companyId) return "";
  try {
    return localStorage.getItem(storageKey(companyId, templateType)) || "";
  } catch {
    return "";
  }
};

export function usePrintTemplates(templateType) {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canViewTemplates = has("printtemplates.manage.view");
  const companyId = selectedCompany?.id || null;

  const [allTemplates, setAllTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [selectedId, setSelectedIdState] = useState(() => readStored(companyId, templateType));

  // One fetch per company (all types) — the type filter is client-side, so
  // switching type (bills ⇄ notes) doesn't refetch.
  useEffect(() => {
    let alive = true;
    setAllTemplates([]);
    setTemplatesLoaded(false);
    if (!companyId || !canViewTemplates) return () => { alive = false; };
    getTemplatesByCompany(companyId)
      .then(({ data }) => { if (alive) { setAllTemplates(data || []); setTemplatesLoaded(true); } })
      .catch(() => { if (alive) { setAllTemplates([]); setTemplatesLoaded(false); } });
    return () => { alive = false; };
  }, [companyId, canViewTemplates]);

  // Re-read the remembered choice when the company or document type changes.
  useEffect(() => {
    setSelectedIdState(readStored(companyId, templateType));
  }, [companyId, templateType]);

  // All templates of this type — exactly what the picker lists and what Print/PDF
  // resolve against.
  const templates = useMemo(
    () => allTemplates.filter((t) => t.templateType === templateType),
    [allTemplates, templateType]
  );

  // Gating signal for the picker + Print/PDF buttons: true once we've CONFIRMED
  // this type has zero templates (and the operator can list templates).
  // Print-only roles (no printtemplates.manage.view) can't load the list, so
  // this stays false for them — they keep the built-in fallback.
  const noTemplate = canViewTemplates && templatesLoaded && templates.length === 0;
  const noTemplateReason =
    "No print template exists for this document type yet. Add one on the Print Templates page (Configuration → Print Templates).";

  const setSelectedId = useCallback((id) => {
    const next = id == null ? "" : String(id);
    setSelectedIdState(next);
    if (!companyId) return;
    try {
      if (next === "") localStorage.removeItem(storageKey(companyId, templateType));
      else localStorage.setItem(storageKey(companyId, templateType), next);
    } catch { /* private mode — non-fatal */ }
  }, [companyId, templateType]);

  // A remembered template that no longer exists (deleted) resets to Auto so the
  // picker never shows a phantom selection.
  useEffect(() => {
    if (!templatesLoaded || selectedId === "") return;
    if (!templates.some((t) => String(t.id) === selectedId)) setSelectedId("");
  }, [templatesLoaded, templates, selectedId, setSelectedId]);

  // "Auto" resolution: the type's default-flagged template, else the oldest row
  // (lowest id) for a deterministic, stable choice. The DB enforces at most one
  // default per (company, type). Sorted on a COPY so `templates` is never mutated.
  const resolveAuto = useCallback(() => {
    const inScope = [...templates].sort((a, b) => a.id - b.id);
    return inScope.find((t) => t.isDefault) || inScope[0] || null;
  }, [templates]);

  const selectedTemplate = useMemo(
    () => (selectedId === "" ? null : templates.find((t) => String(t.id) === selectedId) || null),
    [templates, selectedId]
  );

  // Explicit pick wins; Auto (or a not-yet-validated stale pick) falls back to
  // the default template. The `doc` argument is accepted for call-site
  // compatibility but not consulted.
  const resolveTemplate = useCallback(
    (_doc) => selectedTemplate || resolveAuto(),
    [selectedTemplate, resolveAuto]
  );

  return {
    templates,
    templatesLoaded,
    noTemplate,
    noTemplateReason,
    selectedId,
    setSelectedId,
    selectedTemplate,
    resolveAuto,
    resolveTemplate,
    // Show the selector only once we've CONFIRMED (post-fetch) the type has at
    // least one template. Gating on `templatesLoaded` (not just `!noTemplate`)
    // matters: before the fetch resolves, `noTemplate` is false, so the old
    // `!noTemplate` form reported canChoose=true prematurely — the picker
    // mounted, then unmounted when the load returned zero templates, producing a
    // visible flash + toolbar reflow ("jerk") on screens whose company has no
    // template of that type (e.g. Receipts / Payments). Requiring
    // `templatesLoaded && length>0` shows the picker only when it's real.
    canChoose: canViewTemplates && templatesLoaded && templates.length > 0,
  };
}
