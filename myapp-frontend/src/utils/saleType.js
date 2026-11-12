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

/**
 * True when a catalog row belongs in a picker locked to `scenarioSaleType`.
 *
 * A row with no sale type, or with the standard-rate default, fits EVERY
 * scenario: when the bill names a scenario, filing gives each line the
 * scenario's sale type (FbrService, 2026-09-24), so the catalog's value never
 * reaches FBR. The imports save no sale type and the Item Type form starts on
 * the standard-rate default, so filtering on either left SN005 / SN006 /
 * SN007 / SN024 pickers empty. Only a row with another special sale type of
 * its own (Exempt Goods under SN024, say) is kept out.
 */
export function matchesScenarioSaleType(itemType, scenarioSaleType) {
  const target = (scenarioSaleType || "").trim().toLowerCase();
  const own = (itemType?.saleType || "").trim().toLowerCase();
  if (!target || !own || own === DEFAULT_SALE_TYPE.toLowerCase()) return true;
  return own === target;
}
