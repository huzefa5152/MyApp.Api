// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ItemTypeForm from "./ItemTypeForm";
import * as api from "../api/itemTypeApi";
vi.mock("../api/itemTypeApi", () => ({ createItemType: vi.fn(), updateItemType: vi.fn(), getItemTypeFbrHints: vi.fn() }));
vi.mock("./HsCodeAutocomplete", () => ({ default: ({ value, onChange }) => <input aria-label="HS code" value={value} onChange={e => onChange(e.target.value)} /> }));
vi.mock("./LookupAutocomplete", () => ({ default: ({ value, onChange }) => <input aria-label="Usual unit" value={value} onChange={e => onChange(e.target.value)} /> }));
beforeEach(() => {
  vi.clearAllMocks(); Element.prototype.scrollIntoView = vi.fn();
  api.createItemType.mockResolvedValue({ data: { id: 1 } });
  api.getItemTypeFbrHints.mockResolvedValue({ data: { defaultUom: { uoM_ID: 10, description: "Pack" }, uoms: [{ uoM_ID: 10, description: "Pack" }, { uoM_ID: 11, description: "KG" }] } });
});
afterEach(cleanup);
it("creates a bill category without HS code or sale type", async () => {
  render(<ItemTypeForm purpose="bill" companyId={42} />);
  expect(screen.queryByLabelText("HS code")).toBeNull();
  fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Commercial category" } });
  fireEvent.change(screen.getByLabelText("Usual unit"), { target: { value: "Pack" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(api.createItemType).toHaveBeenCalled());
  expect(api.createItemType.mock.calls[0]).toEqual([expect.objectContaining({ hsCode: null, saleType: null, uom: "Pack" }), 42]);
});
it("allows either FBR-supported unit as the classification default", async () => {
  render(<ItemTypeForm purpose="classification" companyId={42} />);
  fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Medicine" } });
  fireEvent.change(screen.getByLabelText("HS code"), { target: { value: "3004.9099" } });
  const unit = await screen.findByLabelText("Default filing unit");
  fireEvent.change(unit, { target: { value: "11" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(api.createItemType).toHaveBeenCalled());
  expect(api.createItemType.mock.calls[0]).toEqual([expect.objectContaining({ hsCode: "3004.9099", uom: "KG", fbrUOMId: 11 }), 42]);
});
