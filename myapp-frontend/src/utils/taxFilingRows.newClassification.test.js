import { expect, it } from "vitest";
import { filingErrors } from "./taxFilingRows";
const row = { sourceLineIds: [1], itemTypeId: null, hsCode: "9403.6000", description: "Office furniture",
  uom: "Numbers", saleType: "Goods at standard rate (default)", quantity: 3, valueExclTax: 100 };
const bill = { items: [{ id: 1 }], subtotal: 100 };
it("a named new classification can be saved without a catalog id", () => {
  expect(filingErrors([row], bill)).toEqual([]);
});
it("a new classification requires a name", () => {
  expect(filingErrors([{ ...row, description: "  " }], bill).join(" ")).toContain("enter a name");
});
it("new classifications still require a unit and exact bill totals", () => {
  const issues = filingErrors([{ ...row, uom: "", valueExclTax: 99.99 }], bill).join(" ");
  expect(issues).toContain("unit and sale type");
  expect(issues).toContain("exactly");
});
