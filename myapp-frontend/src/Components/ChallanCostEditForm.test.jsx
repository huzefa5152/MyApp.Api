// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChallanCostEditForm from "./ChallanCostEditForm";
import { updateChallanPrivateCosts } from "../api/challanApi";
const { preview, permissions } = vi.hoisted(() => ({ preview: vi.fn(), permissions: new Set() }));
vi.mock("../api/challanApi", () => ({ updateChallanPrivateCosts: vi.fn() }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: key => permissions.has(key) }) }));
vi.mock("./ChallanPurchasePreview", () => ({ useChallanPurchasePreview: () => ({ create: preview, dialog: null }) }));
vi.mock("./ChallanPrivateCosts", () => ({ useChallanSuppliers: () => [], default: ({ items, onItemsChange, readOnly }) => <input aria-label="Actual cost" disabled={readOnly} value={items[0].actualUnitCost ?? ""} onChange={e => onItemsChange(items.map(i => ({ ...i, actualUnitCost: e.target.value })))} /> }));
const challan = { id: 17, companyId: 2, challanNumber: 10, invoiceId: 22, invoiceFbrStatus: "Submitted", version: "revision", items: [{ id: 31, description: "Sample goods", quantity: 4, unit: "Pcs", supplierId: 5, actualUnitCost: 12 }] };
beforeEach(() => { vi.clearAllMocks(); permissions.clear(); updateChallanPrivateCosts.mockResolvedValue({ data: { version: "saved" } }); preview.mockResolvedValue(true); });
afterEach(cleanup);
it("submitted billed challans save only private fields without changing delivery or bill", async () => {
  const onSaved = vi.fn(); render(<ChallanCostEditForm challan={challan} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText("Actual cost"), { target: { value: "19" } });
  fireEvent.click(screen.getByText("Save supplier & cost"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(updateChallanPrivateCosts).toHaveBeenCalledWith(17, { version: "revision", items: [{ id: 31, supplierId: 5, actualUnitCost: "19" }] });
  expect(preview).not.toHaveBeenCalled();
  expect(screen.queryByText("Save & preview supplier purchases")).toBeNull();
});
it("purchase retry does not save the challan twice", async () => {
  permissions.add("purchasebills.manage.create"); permissions.add("challans.list.view");
  preview.mockRejectedValueOnce(new Error("retry"));
  const onSaved = vi.fn(); render(<ChallanCostEditForm challan={challan} onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Save & preview supplier purchases"));
  await screen.findByRole("alert");
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Preview supplier purchases"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(updateChallanPrivateCosts).toHaveBeenCalledOnce(); expect(preview).toHaveBeenCalledTimes(2);
});
it("existing supplier purchase bills keep costs locked", () => {
  render(<ChallanCostEditForm challan={{ ...challan, hasAutoPurchaseBills: true }} />);
  expect(screen.getByLabelText("Actual cost").disabled).toBe(true);
  expect(screen.queryByText("Save supplier & cost")).toBeNull();
});
