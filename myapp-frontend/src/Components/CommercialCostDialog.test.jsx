// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { notify } from "../utils/notify";
import CommercialCostDialog from "./CommercialCostDialog";
import { readCosts, saveCosts, billPayables } from "../api/commercialCostApi";

const { permissions } = vi.hoisted(() => ({ permissions: new Set() }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: key => permissions.has(key) }) }));
vi.mock("../api/commercialCostApi", () => ({ readCosts: vi.fn(), saveCosts: vi.fn(), billPayables: vi.fn() }));
vi.mock("../utils/notify", () => ({ notify: vi.fn() }));
vi.mock("./PurchaseBillForm", () => ({ default: ({ localSource }) => <div role="dialog" aria-label="Purchase form">{localSource.kind}:{localSource.id}</div> }));
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
let onClose;
function mount() { onClose = vi.fn(); return render(<MemoryRouter><CommercialCostDialog id={3} companyId={2} onClose={onClose} /></MemoryRouter>); }

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
it("never fetches supplier balances without payable permission", async () => {
  mount(); await screen.findByText("Payable not recorded");
  expect(billPayables).not.toHaveBeenCalled();
});

it("saving costs is the whole step: no review, no separate purchase call", async () => {
  permissions.add("purchasebills.manage.create"); permissions.add("bills.costs.update");
  const booked = { ...source.items[0], supplierId: 5, actualUnitCost: 20, purchasedQuantity: 2, remainingQuantity: 0, purchasedAmount: 40, purchaseRecorded: true };
  saveCosts.mockResolvedValue({ data: { ...source, version: "b", items: [booked] } });
  mount(); await screen.findByText("Payable not recorded");
  expect(screen.queryByText("Preview supplier purchases")).toBeNull();
  fireEvent.change(screen.getByLabelText("Actual cost"), { target: { value: "20" } });
  fireEvent.click(screen.getByText("Save costs"));
  await waitFor(() => expect(saveCosts).toHaveBeenCalledTimes(1));
  // Saving is the end of the step: the dialog closes and says what was booked.
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("booked as supplier purchases"), "success");
});
it("a cost without a supplier is an estimate: shown as such, and saving says nothing was booked for it", async () => {
  permissions.add("bills.costs.update");
  readCosts.mockResolvedValue({ data: { ...source, items: [{ ...source.items[0], actualUnitCost: 20, supplierId: null }] } });
  saveCosts.mockResolvedValue({ data: { ...source, version: "b", items: [{ ...source.items[0], actualUnitCost: 25, supplierId: null }] } });
  mount();
  expect(await screen.findByText("Estimate only · no supplier, so no purchase is booked")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Actual cost"), { target: { value: "25" } });
  fireEvent.click(screen.getByText("Save costs"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("no supplier purchase booked"), "success");
});
it("Save costs looks and is disabled until something changes", async () => {
  permissions.add("bills.costs.update");
  mount(); await screen.findByText("Payable not recorded");
  const save = screen.getByText("Save costs");
  expect(save.disabled).toBe(true);
  expect(save.style.opacity).toBe("0.55");
});
it("shows a partly booked line with what is booked and its profit on booked plus estimate", async () => {
  readCosts.mockResolvedValue({ data: { ...source, items: [{ ...source.items[0], quantity: 5, purchasedQuantity: 2, remainingQuantity: 3, purchasedAmount: 40, actualUnitCost: 25 }] } });
  mount();
  expect(await screen.findByText("2 of 5 booked · Rs. 40.00")).toBeTruthy();
  expect(screen.getByText("Profit: Rs. -15.00")).toBeTruthy();
});
it("opens the purchase form for a differing supplier invoice only after costs are saved", async () => {
  permissions.add("purchasebills.manage.create"); permissions.add("bills.costs.update");
  mount(); await screen.findByText("Payable not recorded");
  fireEvent.change(screen.getByLabelText("Actual cost"), { target: { value: "5" } });
  expect(screen.getByText("Enter supplier's invoice").disabled).toBe(true);
  cleanup(); mount(); fireEvent.click(await screen.findByText("Enter supplier's invoice"));
  expect(screen.getByRole("dialog", { name: "Purchase form" }).textContent).toBe("bill:3");
});
it("shows the server's reason when a save is refused", async () => {
  permissions.add("bills.costs.update");
  saveCosts.mockRejectedValue({ response: { data: { error: "The accounting period is closed up to 30 Sep 2026." } } });
  mount(); await screen.findByText("Payable not recorded");
  fireEvent.change(screen.getByLabelText("Actual cost"), { target: { value: "5" } });
  fireEvent.click(screen.getByText("Save costs"));
  expect((await screen.findByRole("alert")).textContent).toContain("accounting period is closed");
});
