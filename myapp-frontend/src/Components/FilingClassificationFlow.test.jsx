// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FilingClassificationFields from "./FilingClassificationFields";
import { getFbrHSCodes } from "../api/fbrApi";
import { getItemTypeFbrHints } from "../api/itemTypeApi";
vi.mock("../api/fbrApi", () => ({ getFbrHSCodes: vi.fn() }));
vi.mock("../api/itemTypeApi", () => ({ getItemTypeFbrHints: vi.fn() }));
const sale = "Goods at Standard Rate (default)";
const units = [{ uoM_ID: 12, description: "KG" }, { uoM_ID: 13, description: "Feet" }];
function Harness({ types = [], canAdjustNumbers = true }) {
  const [row, setRow] = useState({ itemTypeId: null, hsCode: "", description: "", uom: "", quantity: 3, valueExclTax: 100 });
  return <><FilingClassificationFields row={row} index={0} companyId={7} types={types} onChange={setRow} canAdjustNumbers={canAdjustNumbers} /><output data-testid="draft">{JSON.stringify(row)}</output></>;
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent);
beforeEach(() => {
  vi.clearAllMocks();
  getFbrHSCodes.mockResolvedValue({ data: [{ hS_CODE: "9403.6000", description: "Official furniture" }] });
  getItemTypeFbrHints.mockResolvedValue({ data: { uoms: units, defaultSaleType: sale, saleTypes: [sale, "Exempt goods"] } });
});
afterEach(cleanup);
async function pickFbr() {
  fireEvent.focus(screen.getByLabelText("Row 1 FBR HS code"));
  fireEvent.mouseDown(await screen.findByText("Official furniture"));
}
it("one search includes existing stock and the FBR catalog, with different status labels", async () => {
  render(<Harness types={[{ id: 20, name: "Company screws", hsCode: "7318.1510", uom: "KG", availableQty: 15 }]} />);
  fireEvent.focus(screen.getByLabelText("Row 1 FBR HS code"));
  await screen.findByText("Official furniture");
  expect(screen.getByText(/Company item · 15 in stock/)).toBeTruthy();
  expect(screen.getByText("FBR catalog · Add to this company on save")).toBeTruthy();
  expect(getFbrHSCodes).toHaveBeenCalledWith(7, "", null, {});
});
it("multiple FBR units require a choice and sale type is editable", async () => {
  render(<Harness />); await pickFbr();
  const unit = await screen.findByLabelText("Row 1 filing unit");
  expect(unit.value).toBe("");
  expect(screen.getByLabelText("Row 1 new item name").value).toBe("Official furniture");
  fireEvent.change(unit, { target: { value: "13" } });
  fireEvent.change(screen.getByLabelText("Row 1 sale type"), { target: { value: "Exempt goods" } });
  expect(draft()).toMatchObject({ itemTypeId: null, uom: "Feet", fbrUOMId: 13, selectedFbrUOMId: 13,
    selectedSaleType: "Exempt goods", saleType: "Exempt goods", valueExclTax: 100 });
});
it("one FBR unit selects automatically without changing quantity or amount", async () => {
  getItemTypeFbrHints.mockResolvedValue({ data: { uoms: [units[0]], defaultSaleType: sale } });
  render(<Harness />); await pickFbr();
  await waitFor(() => expect(draft().fbrUOMId).toBe(12));
  expect(draft()).toMatchObject({ uom: "KG", quantity: 3, valueExclTax: 100, saleType: sale });
});
it("an existing company item still offers every FBR unit for this filing", async () => {
  render(<Harness types={[{ id: 20, name: "Company furniture", hsCode: "9403.6000", uom: "KG", fbrUOMId: 12, saleType: sale, availableQty: 8 }]} />);
  fireEvent.focus(screen.getByLabelText("Row 1 FBR HS code"));
  fireEvent.mouseDown(screen.getByText("Company furniture"));
  const unit = await screen.findByLabelText("Row 1 filing unit");
  expect(unit.value).toBe("12");
  fireEvent.change(unit, { target: { value: "13" } });
  expect(draft()).toMatchObject({ itemTypeId: 20, uom: "Feet", selectedFbrUOMId: 13, quantity: "" });
  expect(screen.queryByLabelText("Row 1 new item name")).toBeNull();
});
