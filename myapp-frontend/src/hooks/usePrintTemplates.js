import { useCallback, useEffect, useMemo, useState } from "react";
import { getTemplatesByCompany } from "../api/printTemplateApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";

// Generic per-document-type print-template picker state, shared by every
// document screen (quotes, orders, challans, bills, tax invoices, notes,
// purchase bills, goods receipts).
//
// Semantics:
// - selectedId "" = "Auto (default)" — resolution is byte-identical to the
//   legacy behavior (company-level default; division-aware only on screens
//   that opt in via `divisionAware`, i.e. Sales Quotes).
// - A non-empty selectedId pins an explicit template: Print/PDF then use it
//   for every document printed from the screen, overriding the default.
// - The choice persists per (company, templateType) in localStorage and is
//   restored on the next visit; a stale id (template deleted) silently
//   resets to Auto once the list loads.
// - Loading the list requires printtemplates.manage.view (same dependency
//   the Sales Quote screen already had). Without it, templates stay empty,
//   the dropdown hides, and printing falls back exactly as before (per-type
//   built-in default template).
const storageKey = (companyId, templateType) => `printTpl:${companyId}:${templateType}`;

const readStored = (companyId, templateType) => {
  if (!companyId) return "";
  try {
    return localStorage.getItem(storageKey(companyId, templateType)) || "";
  } catch {
    return "";
  }
};

export function usePrintTemplates(templateType, { divisionAware = false } = {}) {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canViewTemplates = has("printtemplates.manage.view");
  const companyId = selectedCompany?.id || null;

  const [allTemplates, setAllTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [selectedId, setSelectedIdState] = useState(() => readStored(companyId, templateType));

  // One fetch per company (all types) — the type filter is client-side, so a
  // screen that switches types (bills ⇄ notes) doesn't refetch.
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

  const templates = useMemo(
    () => allTemplates.filter((t) => t.templateType === templateType),
    [allTemplates, templateType]
  );

  // Gating signal for Print/PDF buttons: true only once we've CONFIRMED this
  // company has zero templates of this type (and the operator can see
  // templates). Print-only roles (no printtemplates.manage.view) can't load
  // the list, so this stays false for them — they keep the built-in fallback
  // rather than being locked out.
  const noTemplate = canViewTemplates && templatesLoaded && templates.length === 0;
  const noTemplateReason =
    "No print template exists for this document type yet — add one on the Print Templates page (Configuration → Print Templates).";

  const setSelectedId = useCallback((id) => {
    const next = id == null ? "" : String(id);
    setSelectedIdState(next);
    if (!companyId) return;
    try {
      if (next === "") localStorage.removeItem(storageKey(companyId, templateType));
      else localStorage.setItem(storageKey(companyId, templateType), next);
    } catch { /* private mode — non-fatal */ }
  }, [companyId, templateType]);

  // A remembered template that no longer exists (deleted / division revoked)
  // resets to Auto so the dropdown never shows a phantom selection.
  useEffect(() => {
    if (!templatesLoaded || selectedId === "") return;
    if (!templates.some((t) => String(t.id) === selectedId)) setSelectedId("");
  }, [templatesLoaded, templates, selectedId, setSelectedId]);

  // "Auto" resolution: the scope's default-flagged template, else a stable
  // fallback. The DB enforces at most one default per scope (filtered unique
  // index) and normally exactly one, so find(isDefault) decides in every
  // ordinary case. The fallback only fires for a defaultless scope (an
  // anomaly, e.g. a division deleted onto company scope) — we pick the
  // oldest row (lowest id) for a deterministic, stable choice rather than
  // relying on incidental list order. Company branch is sorted on a COPY
  // ([...]) so the memoized `templates` array is never mutated.
  const resolveAuto = useCallback((doc) => {
    if (divisionAware && doc?.divisionId) {
      const inDiv = templates.filter((t) => t.divisionId === doc.divisionId);
      if (inDiv.length === 0) return null; // quote rule: division doc needs a division template
      return inDiv.find((t) => t.isDefault) || [...inDiv].sort((a, b) => a.id - b.id)[0];
    }
    const companyLevel = [...templates].filter((t) => !t.divisionId).sort((a, b) => a.id - b.id);
    return companyLevel.find((t) => t.isDefault) || companyLevel[0] || null;
  }, [templates, divisionAware]);

  const selectedTemplate = useMemo(
    () => (selectedId === "" ? null : templates.find((t) => String(t.id) === selectedId) || null),
    [templates, selectedId]
  );

  // Explicit pick wins; Auto (or a not-yet-validated stale pick) falls back
  // to the legacy default resolution for the given document.
  const resolveTemplate = useCallback(
    (doc) => selectedTemplate || resolveAuto(doc),
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
    divisionAware,
    // Show the selector whenever the operator can view templates — even before
    // any custom template of this type exists (it then offers just "Default",
    // the built-in). This keeps the control consistent across every document
    // screen; without it, a doc type with no saved templates (e.g. a fresh
    // Goods Receipt) silently had no picker at all.
    canChoose: canViewTemplates,
  };
}
