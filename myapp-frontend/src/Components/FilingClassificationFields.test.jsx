// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FilingClassificationFields from "./FilingClassificationFields";
import { getItemTypeFbrHints } from "../api/itemTypeApi";
vi.mock("../api/itemTypeApi", () => ({ getItemTypeFbrHints: vi.fn() }));
vi.mock("./HsCodeAutocomplete", () => ({ default: ({ value, onChange, ariaLabel }) => <input aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} /> }));
vi.mock("./SearchableItemTypeSelect", () => ({ default: () => null }));
const initial = { sourceLineIds: [4], quantity: 3, valueExclTax: 100, itemTypeId: null, hsCode: "", uom: "Nos", description: "Commercial name" };
const hints = { uoms: [{ uoM_ID: 13, description: "Numbers" }], defaultSaleType: "Goods at standard rate (default)" };
function Harness({ types = [] }) {
  const [row, setRow] = useState(initial);
  return <><FilingClassificationFields row={row} index={0} companyId={7} types={types} onChange={setRow} /><output data-testid="row">{JSON.stringify(row)}</output></>;
}
beforeEach(() => { vi.clearAllMocks(); getItemTypeFbrHints.mockResolvedValue({ data: hints }); });
afterEach(cleanup);
it("new FBR codes collect a company item name and FBR unit while preserving amounts", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Row 1 FBR HS code"), { target: { value: "9403.6000" } });
  expect(screen.getByLabelText("Row 1 new item name").value).toBe("");
  fireEvent.change(screen.getByLabelText("Row 1 new item name"), { target: { value: "Office furniture" } });
  fireEvent.change(await screen.findByLabelText("Row 1 filing unit"), { target: { value: "13" } });
  const row = JSON.parse(screen.getByTestId("row").textContent);
  expect(row).toMatchObject({ itemTypeId: null, hsCode: "9403.6000", description: "Office furniture", uom: "Numbers", fbrUOMId: 13, quantity: 3, valueExclTax: 100 });
  expect(getItemTypeFbrHints).toHaveBeenCalledWith(7, "9403.6000");
});
it("a matching company item is reused without new-name entry", () => {
  render(<Harness types={[{ id: 22, name: "Saved furniture", hsCode: "9403.6000", uom: "Nos", saleType: hints.defaultSaleType }]} />);
  fireEvent.change(screen.getByLabelText("Row 1 FBR HS code"), { target: { value: "9403.6000" } });
  expect(JSON.parse(screen.getByTestId("row").textContent)).toMatchObject({ itemTypeId: 22, description: "Saved furniture" });
  expect(screen.queryByLabelText("Row 1 new item name")).toBeNull();
});
it("lookup failure keeps the draft and offers retry", async () => {
  getItemTypeFbrHints.mockRejectedValueOnce(new Error("offline"));
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Row 1 FBR HS code"), { target: { value: "9403.6000" } });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Retry FBR units"));
  await screen.findByLabelText("Row 1 filing unit");
  expect(getItemTypeFbrHints).toHaveBeenCalledTimes(2);
});
it("a late lookup for the previous code cannot replace the current unit choices", async () => {
  let complete;
  getItemTypeFbrHints.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Row 1 FBR HS code"), { target: { value: "9403.6000" } });
  await waitFor(() => expect(getItemTypeFbrHints).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText("Row 1 FBR HS code"), { target: { value: "9401.3000" } });
  await screen.findByLabelText("Row 1 filing unit");
  complete({ data: { ...hints, uoms: [{ uoM_ID: 99, description: "Wrong old unit" }] } });
  await waitFor(() => expect(screen.queryByText("Wrong old unit")).toBeNull());
});
