import { describe, it, expect } from "vitest";
import { withTaxUom, taxGroupKey } from "./taxInvoiceGrouping";
const types = [{ id: 1, uom: "Pcs", fbrUOMId: 7 }];
const row = { itemTypeId: 1, itemTypeName: "Sample electrical goods", hsCode: "8536", saleType: "Goods" };
describe("consultant tax grouping", () => {
  it("collapses commercial units using catalog UOM without mutating bill rows", () => {
    const bills = ["Nos", "Ft", "Pcs"].map(uom => ({ ...row, uom }));
    const tax = bills.map(r => withTaxUom(r, types));
    expect(new Set(tax.map(taxGroupKey)).size).toBe(1);
    expect(tax.every(r => r.uom === "Pcs" && r.fbrUOMId === 7)).toBe(true);
    expect(bills.map(r => r.uom)).toEqual(["Nos", "Ft", "Pcs"]);
  });
  it("preserves consultant classification UOM and filed snapshots", () => {
    expect(withTaxUom({ ...row, adjustment: { adjustedUOM: "KG", adjustedFbrUOMId: 2 } }, types).uom).toBe("KG");
    expect(withTaxUom({ ...row, uom: "Nos" }, types, true).uom).toBe("Nos");
  });
  it("groups the editor by item type regardless of commercial units", () => {
    expect(taxGroupKey({ ...row, uom: "Nos" }, 0)).toBe(taxGroupKey({ ...row, uom: "Ft" }, 1));
    expect(taxGroupKey({ ...row, itemTypeId: 2 }, 0)).not.toBe(taxGroupKey(row, 0));
  });
  it("keeps unclassified lines separate and handles missing catalogs", () => {
    expect(taxGroupKey({}, 0)).not.toBe(taxGroupKey({}, 1));
    expect(withTaxUom({ ...row, uom: "Ft" }, []).uom).toBe("Ft");
  });
});
