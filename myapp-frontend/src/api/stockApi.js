import http from "./httpClient";

export const getStockOnHand = (companyId) =>
  http.get(`/stock/company/${companyId}/onhand`);
// V2 derived inventory summary: OnHand / Committed / ToDeliver / Delivered /
// Available / Incoming per item type, computed live from documents.
export const getInventorySummary = (companyId) =>
  http.get(`/stock/company/${companyId}/summary`);
// Switch a company's inventory tracking version (1 = legacy HS-gated, 2 =
// standard inventory). Reversible + audited; gated by stock.policy.manage.
export const setInventoryFlowVersion = (companyId, version) =>
  http.post(`/stock/company/${companyId}/flow-version`, { version });
// Per-company item policy override: mode 0=default, 1=force-tracked,
// 2=FBR-only (excluded from inventory) + optional reorder level.
export const setItemTypePolicy = (companyId, itemTypeId, mode, reorderLevel = null) =>
  http.post(`/stock/company/${companyId}/itemtype-policy`, { itemTypeId, mode, reorderLevel });
export const getStockMovements = (companyId, params = {}) =>
  http.get(`/stock/company/${companyId}/movements`, { params });
export const getStockGdDetails = (companyId, itemTypeId) =>
  http.get(`/stock/company/${companyId}/gd-details`, { params: { itemTypeId } });
// One GD line's claimed month. `line` is { lotId } or { consignmentLineId },
// straight from the GD detail row.
export const setLineClaimMonth = (companyId, line, claimMonth) =>
  http.put(`/stock/company/${companyId}/line-claim-month`, {
    lotId: line.lotId ?? null,
    consignmentLineId: line.consignmentLineId ?? null,
    claimMonth: claimMonth ? `${claimMonth}-01` : null,
  });
// The on-hand dashboard as a styled .xlsx, with each item's movement history
// nested under it as a collapsed Excel group. `search` is the same item-or-HS
// match the dashboard's search box makes, so the sheet mirrors the screen.
// Gated server-side by stock.dashboard.export; movement detail additionally
// needs stock.movements.view. Returns a blob — the caller triggers the save.
export const exportStockOnHand = (companyId, search = "") =>
  http.get(`/stock/company/${companyId}/onhand/excel`, {
    params: search ? { search } : {},
    responseType: "blob",
  });
// The client's MONTHLY stock sheet (FIFO-by-GD companies only): one row per
// GD line with its HS code; Opening on the 1st, the month's Consumed, Balance
// at month end. `month` is "yyyy-MM".
export const exportStockMonthly = (companyId, month, search = "") =>
  http.get(`/stock/company/${companyId}/onhand/excel/monthly`, {
    params: search ? { month, search } : { month },
    responseType: "blob",
  });
// Annex-H1 (SRO 55(I)/2025) for a month: the monthly sheet rolled up per HS
// code x unit x rate, at cost. FIFO-by-GD companies only. `month` is "yyyy-MM".
export const exportAnnexH1 = (companyId, month) =>
  http.get(`/stock/company/${companyId}/annex-h1/excel`, {
    params: { month },
    responseType: "blob",
  });
// The item types this company actually tracks stock for. "Which items can
// hold a position" is a server rule (V1 = HS-coded, V2 = all, per-company
// overrides win either way), so the modals ask for it instead of guessing.
export const getTrackedItemTypes = (companyId) =>
  http.get(`/stock/company/${companyId}/tracked-itemtypes`);

export const getOpeningBalances = (companyId) =>
  http.get(`/stock/company/${companyId}/opening`);
export const upsertOpeningBalance = (payload) =>
  http.post("/stock/opening", payload);
export const deleteOpeningBalance = (id) =>
  http.delete(`/stock/opening/${id}`);
export const adjustStock = (payload) =>
  http.post("/stock/adjust", payload);

// The audit trail behind an item's actual cost (2026-09-13) -- every recorded
// change to its cost, quantity and selling value, newest first. Omit
// itemTypeId for the whole company's history, which is how a bad import is
// found before anyone knows which item went wrong. Gated on
// stock.actualcost.view, the same key that redacts the cost columns.
export const getStockCostChanges = (companyId, params = {}) =>
  http.get(`/stock/company/${companyId}/cost-changes`, { params });

// How the company values stock: "WeightedAverage" or "GdFifo" (FIFO by GD,
// claimed GDs first). New companies start on GdFifo and it is one-way, so the
// screen only reads it (the Stock Dashboard's costing pill).
export const getCostingMethod = (companyId) =>
  http.get(`/stock/company/${companyId}/costing-method`);
