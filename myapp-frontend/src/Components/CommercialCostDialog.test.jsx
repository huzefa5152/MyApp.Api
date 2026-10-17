// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CommercialCostDialog from "./CommercialCostDialog";
import { readCosts, saveCosts, createLocalPurchases, billPayables } from "../api/commercialCostApi";

const { permissions } = vi.hoisted(() => ({ permissions: new Set() }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: key => permissions.has(key) }) }));
vi.mock("../api/commercialCostApi", () => ({ readCosts: vi.fn(), saveCosts: vi.fn(), createLocalPurchases: vi.fn(), billPayables: vi.fn() }));
vi.mock("./ChallanPrivateCosts", () => ({
  useChallanSuppliers: () => [{ id: 5, name: "Sample supplier" }],
  default: ({ items, onItemsChange, readOnly }) => <input aria-label="Actual cost" disabled={readOnly} value={items[0]?.actualUnitCost ?? ""}
    onChange={e => onItemsChange(items.map(i => ({ ...i, actualUnitCost: e.target.value })))} />,
}));
const source = { id: 3, number: 10, companyId: 2, version: "a", sellingAmount: 100, items: [
  { id: 8, description: "Sample item", quantity: 2, sellingAmount: 100, actualUnitCost: null, supplierId: null, purchaseRecorded: false },
] };
beforeEach(() => { vi.clearAllMocks(); permissions.clear(); permissions.add("bills.costs.view"); readCosts.mockResolvedValue({ data: structuredClone(source) }); billPayables.mockResolvedValue({ data: [] }); });
afterEach(cleanup);
function mount() { return render(<MemoryRouter><CommercialCostDialog id={3} companyId={2} onClose={vi.fn()} /></MemoryRouter>); }

it("shows missing actual cost as provisional instead of a complete profit", async () => {
  mount(); await screen.findByText("Provisional profit · Cost incomplete");
  expect(screen.getByText("Payable not recorded")).toBeTruthy();
  expect(screen.queryByText("Save costs")).toBeNull();
});
it("allows zero costs without a supplier and keeps edits independent of filing", async () => {
  permissions.add("bills.costs.update");
  saveCosts.mockResolvedValue({ data: { ...source, version: "b", items: [{ ...source.items[0], actualUnitCost: 0 }] } });
  mount(); await screen.findByText("Provisional profit · Cost incomplete");
  fireEvent.change(screen.getByLabelText("Actual cost"), { target: { value: "0" } });
  fireEvent.click(screen.getByText("Save costs"));
  await waitFor(() => expect(saveCosts).toHaveBeenCalledWith("bill", 3, { version: "a", items: [{ id: 8, supplierId: null, actualUnitCost: 0 }] }));
  await screen.findByText("Commercial profit");
});
it("requires purchase preview and explicit confirmation before creating debt", async () => {
  permissions.add("purchasebills.manage.create");
  readCosts.mockResolvedValue({ data: { ...source, items: [{ ...source.items[0], supplierId: 5, actualUnitCost: 20 }] } });
  createLocalPurchases.mockResolvedValue({ data: [11] });
  mount(); fireEvent.click(await screen.findByText("Preview supplier purchases"));
  expect(createLocalPurchases).not.toHaveBeenCalled();
  await screen.findByText("Review local supplier purchases");
  fireEvent.click(screen.getByText("Create supplier purchases"));
  await waitFor(() => expect(createLocalPurchases).toHaveBeenCalledWith("bill", 3, expect.objectContaining({ version: "a", itemIds: [8] })));
});
it("never fetches supplier balances without payable permission", async () => {
  mount(); await screen.findByText("Payable not recorded");
  expect(billPayables).not.toHaveBeenCalled();
});

it("explains missing costs and supplier instead of silently disabling preview", async () => {
  permissions.add("purchasebills.manage.create");
  mount(); fireEvent.click(await screen.findByText("Preview supplier purchases"));
  expect((await screen.findByRole("alert")).textContent).toContain("Add an actual cost and choose a supplier");
  expect(createLocalPurchases).not.toHaveBeenCalled();
});
it("saves edited costs before opening purchase review", async () => {
  permissions.add("purchasebills.manage.create"); permissions.add("bills.costs.update");
  const row = { ...source.items[0], supplierId: 5, actualUnitCost: 20 };
  readCosts.mockResolvedValue({ data: { ...source, items: [row] } });
  saveCosts.mockResolvedValue({ data: { ...source, version: "saved", items: [{ ...row, actualUnitCost: 30 }] } });
  mount(); fireEvent.change(await screen.findByLabelText("Actual cost"), { target: { value: "30" } });
  fireEvent.click(screen.getByText("Preview supplier purchases"));
  await screen.findByText("Review local supplier purchases");
  expect(saveCosts).toHaveBeenCalledWith("bill", 3, expect.objectContaining({ items: [expect.objectContaining({ actualUnitCost: 30 })] }));
  expect(createLocalPurchases).not.toHaveBeenCalled();
});
it("explains when all purchases are already recorded", async () => {
  permissions.add("purchasebills.manage.create");
  readCosts.mockResolvedValue({ data: { ...source, items: [{ ...source.items[0], purchaseRecorded: true }] } });
  mount(); fireEvent.click(await screen.findByText("Preview supplier purchases"));
  expect((await screen.findByRole("alert")).textContent).toContain("already recorded for all lines");
});
it("explains empty selection at purchase confirmation", async () => {
  permissions.add("purchasebills.manage.create");
  readCosts.mockResolvedValue({ data: { ...source, items: [{ ...source.items[0], supplierId: 5, actualUnitCost: 0 }] } });
  mount(); fireEvent.click(await screen.findByText("Preview supplier purchases"));
  fireEvent.click(await screen.findByText(/Selected lines.*Change selection/));
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByText("Create supplier purchases"));
  expect((await screen.findByRole("alert")).textContent).toContain("Select at least one line");
  expect(createLocalPurchases).not.toHaveBeenCalled();
});
