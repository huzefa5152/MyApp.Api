import { useCallback, useEffect, useMemo, useState } from "react";
import { getTemplatesByCompany } from "../api/printTemplateApi";
import { useCompany } from "../contexts/CompanyContext";
import { usePermissions } from "../contexts/PermissionsContext";

// Generic per-document-type print-template picker state, shared by every
// document screen (quotes, orders, challans, bills, tax invoices, notes,
// purchase bills, goods receipts, and the accounting docs).
//
// ── Division-scoped model (2026-07-14) ──────────────────────────────────
// Every document screen now carries a Division selector next to Company, and
// the SELECTED DIVISION drives which print templates are in play — consistently
// across all document types:
//   • "All Divisions" (divisionId "" / null) → ONLY company-wide templates
//     (those with no divisionId).
//   • A specific division → ONLY that division's templates.
//   • If the selected scope has NO template, `noTemplate` is true: the screen
//     hides the picker and blocks Print / Export PDF (in both card and table
//     views) rather than letting the operator print with no valid template.
// Pass the screen's current division filter in as `divisionId`; the hook is
// reactive to it (switching division re-scopes the list, the blocked flag, and
// the remembered pick).
//
// Selection semantics within the scope:
// - selectedId "" = "Auto (default)" — resolves to the scope's default-flagged
//   template, else the oldest (lowest id) template in scope.
// - A non-empty selectedId pins an explicit template within the scope: Print/PDF
//   then use it for every document printed from the screen.
// - The choice persists per (company, templateType, divisionScope) in
//   localStorage and is restored on the next visit; a pick that's no longer in
//   the active scope (division switched, template deleted) silently resets to
//   Auto once the list loads.
// - Loading the list requires printtemplates.manage.view. Without it, templates
//   stay empty, the picker hides, and `noTemplate` stays false so print-only
//   roles keep the built-in fallback template rather than being locked out
//   (we can't scope what we can't read).
const scopeKeyOf = (divisionId) =>
  divisionId === "" || divisionId == null ? "all" : String(divisionId);

const storageKey = (companyId, templateType, scopeKey) =>
  `printTpl:${companyId}:${templateType}:${scopeKey}`;

const readStored = (companyId, templateType, scopeKey) => {
  if (!companyId) return "";
  try {
    return localStorage.getItem(storageKey(companyId, templateType, scopeKey)) || "";
  } catch {
    return "";
  }
};

// ── Shared per-company template cache ───────────────────────────────────────
// The company template list (all types, all scopes) is fetched ONCE per company
// and shared by every usePrintTemplates instance on every document screen. This
// is the fix for "templates load late on every screen": before, all 13 screens
// refetched the list on each mount/navigation. Now the first visit warms the
// cache and the rest are instant, and the list can be prefetched the moment a
// company is selected so even the first picker paints filled, not flashing.
//
// A short TTL guards against a very long session drifting from server state;
// same-session edits invalidate explicitly (management screens call
// invalidatePrintTemplateCache after every mutation).
const CACHE_TTL_MS = 5 * 60 * 1000;
const templateCache = new Map(); // companyId -> { data: [], ts: number, promise: Promise|null }
const cacheSubscribers = new Set(); // notified (companyId|null) on invalidation

// Start (or reuse) a single in-flight fetch for a company; store the promise so
// concurrent callers dedupe onto it, and cache the result on success. Failures
// are NOT cached (so the next mount retries).
function fetchCompanyTemplates(companyId) {
  const existing = templateCache.get(companyId);
  if (existing?.promise) return existing.promise;

  const promise = getTemplatesByCompany(companyId)
    .then(({ data }) => {
      const list = data || [];
      templateCache.set(companyId, { data: list, ts: Date.now(), promise: null });
      return list;
    })
    .catch((err) => {
      templateCache.delete(companyId);
      throw err;
    });

  templateCache.set(companyId, { data: existing?.data || null, ts: existing?.ts || 0, promise });
  return promise;
}

// Warm the cache ahead of time (e.g. right after a company is selected) so the
// first document screen the operator opens shows a filled picker immediately.
export function prefetchPrintTemplates(companyId) {
  if (!companyId) return;
  const entry = templateCache.get(companyId);
  if (entry?.promise) return;                                  // already loading
  if (entry?.data && Date.now() - entry.ts < CACHE_TTL_MS) return; // still fresh
  fetchCompanyTemplates(companyId).catch(() => { /* prefetch is best-effort */ });
}

// Drop a company's cached list (or all companies when companyId is null) and
// tell every live picker to refetch. Management screens call this after any
// create / rename / duplicate / delete / set-default / apply-starter / Excel
// change so document-screen pickers reflect it without a manual reload.
export function invalidatePrintTemplateCache(companyId = null) {
  if (companyId == null) templateCache.clear();
  else templateCache.delete(companyId);
  cacheSubscribers.forEach((fn) => { try { fn(companyId); } catch { /* non-fatal */ } });
}

export function usePrintTemplates(templateType, { divisionId = null } = {}) {
  const { selectedCompany } = useCompany();
  const { has } = usePermissions();
  const canViewTemplates = has("printtemplates.manage.view");
  const companyId = selectedCompany?.id || null;

  // Normalise the selected division scope: "" / null / undefined = All Divisions
  // (company-wide templates); a value = that specific division.
  const scopeDivisionId = divisionId === "" || divisionId == null ? null : Number(divisionId);
  const scopeKey = scopeKeyOf(divisionId);

  // Seed from the shared cache so a warm cache (prefetched, or filled by another
  // screen) paints a filled picker on the very first render — no empty flash.
  const cachedAtMount = companyId ? templateCache.get(companyId)?.data : null;
  const [allTemplates, setAllTemplates] = useState(cachedAtMount || []);
  const [templatesLoaded, setTemplatesLoaded] = useState(!!cachedAtMount);
  const [selectedId, setSelectedIdState] = useState(() => readStored(companyId, templateType, scopeKey));
  // Bumped on cross-screen invalidation to force the load effect to re-run.
  const [reloadTick, setReloadTick] = useState(0);

  // One fetch per company (all types), SHARED across every screen via the
  // module cache — the type + division filters are client-side, so switching
  // type (bills ⇄ notes) or division never refetches, and neither does
  // navigating between document screens while the cache is fresh.
  useEffect(() => {
    let alive = true;
    if (!companyId || !canViewTemplates) {
      setAllTemplates([]);
      setTemplatesLoaded(false);
      return () => { alive = false; };
    }
    const entry = templateCache.get(companyId);
    const fresh = entry?.data && Date.now() - entry.ts < CACHE_TTL_MS;
    if (fresh) {
      // Cache hit — no network, no flash.
      setAllTemplates(entry.data);
      setTemplatesLoaded(true);
      return () => { alive = false; };
    }
    // Cold or stale → (re)fetch, deduped onto any in-flight request.
    setTemplatesLoaded(false);
    fetchCompanyTemplates(companyId)
      .then((list) => { if (alive) { setAllTemplates(list); setTemplatesLoaded(true); } })
      .catch(() => { if (alive) { setAllTemplates([]); setTemplatesLoaded(false); } });
    return () => { alive = false; };
  }, [companyId, canViewTemplates, reloadTick]);

  // Refetch when another screen invalidates this company's cache after a
  // template mutation (create/rename/delete/set-default/duplicate/Excel).
  useEffect(() => {
    const onInvalidate = (invCompanyId) => {
      if (invCompanyId == null || invCompanyId === companyId) setReloadTick((n) => n + 1);
    };
    cacheSubscribers.add(onInvalidate);
    return () => { cacheSubscribers.delete(onInvalidate); };
  }, [companyId]);

  // Re-read the remembered choice when the company, document type, or division
  // scope changes (each scope remembers its own pick).
  useEffect(() => {
    setSelectedIdState(readStored(companyId, templateType, scopeKey));
  }, [companyId, templateType, scopeKey]);

  // All templates of this type (any scope) — the pool we scope from.
  const templatesOfType = useMemo(
    () => allTemplates.filter((t) => t.templateType === templateType),
    [allTemplates, templateType]
  );

  // Scoped to the selected division: All → company-wide (no divisionId);
  // specific → only that division's. This is exactly what the picker lists and
  // what Print/PDF resolve against.
  const templates = useMemo(() => {
    if (scopeDivisionId == null) return templatesOfType.filter((t) => !t.divisionId);
    return templatesOfType.filter((t) => Number(t.divisionId) === scopeDivisionId);
  }, [templatesOfType, scopeDivisionId]);

  // Gating signal for the picker + Print/PDF buttons: true once we've CONFIRMED
  // the SELECTED SCOPE has zero templates (and the operator can list templates).
  // Print-only roles (no printtemplates.manage.view) can't load the list, so
  // this stays false for them — they keep the built-in fallback.
  const noTemplate = canViewTemplates && templatesLoaded && templates.length === 0;
  const noTemplateReason = scopeDivisionId == null
    ? "No company-wide print template exists for this document type yet. Add one on the Print Templates page (Configuration → Print Templates), or select a division that has one."
    : "The selected division has no print template for this document type. Add one on the Print Templates page (Configuration → Print Templates), or switch division.";

  const setSelectedId = useCallback((id) => {
    const next = id == null ? "" : String(id);
    setSelectedIdState(next);
    if (!companyId) return;
    try {
      if (next === "") localStorage.removeItem(storageKey(companyId, templateType, scopeKey));
      else localStorage.setItem(storageKey(companyId, templateType, scopeKey), next);
    } catch { /* private mode — non-fatal */ }
  }, [companyId, templateType, scopeKey]);

  // A remembered template that no longer exists in the active scope (deleted, or
  // the division was switched) resets to Auto so the picker never shows a
  // phantom / out-of-scope selection.
  useEffect(() => {
    if (!templatesLoaded || selectedId === "") return;
    if (!templates.some((t) => String(t.id) === selectedId)) setSelectedId("");
  }, [templatesLoaded, templates, selectedId, setSelectedId]);

  // "Auto" resolution WITHIN the active scope: the scope's default-flagged
  // template, else the oldest row (lowest id) for a deterministic, stable
  // choice. The DB enforces at most one default per (company, division, type)
  // scope. Sorted on a COPY so the memoized `templates` array is never mutated.
  const resolveAuto = useCallback(() => {
    const inScope = [...templates].sort((a, b) => a.id - b.id);
    return inScope.find((t) => t.isDefault) || inScope[0] || null;
  }, [templates]);

  const selectedTemplate = useMemo(
    () => (selectedId === "" ? null : templates.find((t) => String(t.id) === selectedId) || null),
    [templates, selectedId]
  );

  // Explicit pick wins; Auto (or a not-yet-validated stale pick) falls back to
  // the scope's default template. The `doc` argument is accepted for call-site
  // compatibility but no longer consulted — the screen's division selector, not
  // each document's own division, drives the scope now.
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
    // The active division scope (null = All / company-wide), for callers that
    // want to label or reason about it.
    scopeDivisionId,
    // Show the selector whenever the operator can view templates AND the active
    // scope has at least one template. A scope with none hides the picker (the
    // screen also blocks Print/PDF via `noTemplate`).
    canChoose: canViewTemplates && !noTemplate,
  };
}
