/**
 * What an item type with no sale type files as.
 *
 * Mirrors Helpers/FbrSaleTypeDefaults.cs (2026-09-10): the HS tariff import
 * creates item types with no sale type, and every real item on a live
 * tenant's bills carried none -- so the scenario filter in the bill forms hid
 * the bill's OWN item from its picker (blank dropdown on edit) while the
 * server refused the filing. An empty sale type means the standard-rate
 * supply unless the company's FBR settings say otherwise.
 */
export const DEFAULT_SALE_TYPE = "Goods at Standard Rate (default)";

/** The sale type a catalog row files as: its own, else the company default. */
export function effectiveSaleType(itemType, company) {
  const own = (itemType?.saleType || "").trim();
  if (own) return own;
  const companyDefault = (company?.fbrDefaultSaleType || "").trim();
  return companyDefault || DEFAULT_SALE_TYPE;
}

/** True when a catalog row belongs in a picker locked to `scenarioSaleType`. */
export function matchesScenarioSaleType(itemType, scenarioSaleType, company) {
  const target = (scenarioSaleType || "").trim().toLowerCase();
  if (!target) return true;
  return effectiveSaleType(itemType, company).toLowerCase() === target;
}
