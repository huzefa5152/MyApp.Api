import http from "./httpClient";

// ─────────────────────────────────────────────────────────────────────────────
// HS / PCT code master — reference data, NOT tenant data.
//
// None of these calls care whether a company has FBR integration enabled. The
// master is imported once for the whole installation and then read locally, so
// the Item Type screen keeps working with FBR switched off. Only `importHsCodes`
// talks to FBR, and it does so with the installation-wide reference token.
// ─────────────────────────────────────────────────────────────────────────────

/** Search by code prefix or description substring. */
export const searchHsCodes = (search, take = 50) =>
  http.get("/hscodes", { params: { search: search || undefined, take } });

/** How many codes the master holds — 0 means the import has never run. */
export const getHsCodeCount = () => http.get("/hscodes/count");

export const getHsCode = (code) => http.get(`/hscodes/${encodeURIComponent(code)}`);

/**
 * UOMs applicable to one HS code. Answered from the master when known; the
 * optional companyId only picks whose FBR token may fill a gap in the master.
 */
export const getHsCodeUoms = (code, companyId) =>
  http.get(`/hscodes/${encodeURIComponent(code)}/uoms`, {
    params: companyId ? { companyId } : {},
  });

/**
 * Import / re-sync FBR's tariff. Upsert: existing codes keep their row, new
 * codes are added — safe to run as often as the operator likes.
 *
 * companyId is optional and is only used to fall back to that company's own
 * FBR token when no installation-wide reference token is configured.
 */
export const importHsCodes = ({ companyId, createItemTypes = true } = {}) =>
  http.post("/hscodes/import", { companyId, createItemTypes });

// Load the master from the Pakistan Customs Tariff bundled with the product.
// No FBR token and no network call — FBR's catalog endpoints answer 401 without
// OAuth credentials, so this is the only path open to an installation that has
// never been issued one. Brings no UOMs: the published tariff has no unit column.
export const importHsCodesFromTariff = ({ createItemTypes = true } = {}) =>
  http.post("/hscodes/import-tariff", { createItemTypes }, { timeout: 300000 });

/** Masked status of the reference token — never returns the token itself. */
// Fill in units the published tariff does not carry. FBR answers one code per
// call, so this runs in batches — keep calling while `moreToDo` is true.
export const backfillHsUoms = ({ companyId, max = 100, onlyInUse = true } = {}) =>
  http.post("/hscodes/backfill-uoms", { companyId, max, onlyInUse }, { timeout: 600000 });

export const getFbrReferenceToken = () => http.get("/hscodes/reference-token");

export const setFbrReferenceToken = (token, environment) =>
  http.put("/hscodes/reference-token", { token, environment });
