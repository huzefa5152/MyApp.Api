// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import BillChallansEditor from "./BillChallansEditor";
import { getBillChallans, updateBillChallans } from "../api/invoiceApi";
vi.mock("../api/invoiceApi", () => ({ getBillChallans: vi.fn(), updateBillChallans: vi.fn() }));
const source = (id, itemId) => ({ id, challanNumber: 12, poNumber: `PO-${id}`, version: `source-${id}`,
  items: [{ id: itemId, description: `Item ${itemId}`, quantity: 2, unit: "Pcs" }] });
const bill = { id: 1, invoiceNumber: 1, clientName: "Sample buyer", gstRate: 18, furtherTaxRate: 2,
  withholdingTaxRate: 5.5, freightCharges: 50, items: [{ id: 1, deliveryItemId: 10, quantity: 2, unitPrice: 100, lineTotal: 200 }] };
const snapshot = { version: "bill-version", bill, linked: [source(1, 10)], available: [source(2, 20)], hasMore: false };
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); getBillChallans.mockResolvedValue({ data: snapshot }); });
async function open() {
  const onSaved = vi.fn();
  render(<BillChallansEditor invoice={bill} onClose={vi.fn()} onSaved={onSaved} />);
  await screen.findByRole("button", { name: "Add challan 12 record 2" });
  return onSaved;
}
it("distinguishes duplicate numbers and sends new rates with source versions", async () => {
  const onSaved = await open();
  fireEvent.click(screen.getByRole("button", { name: "Add challan 12 record 2" }));
  expect(screen.getByRole("button", { name: "Save challans" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Unit rate for Item 20"), { target: { value: "3940" } });
  expect(screen.getByText("New bill total: Rs 9,696.00")).toBeTruthy();
  updateBillChallans.mockResolvedValue({ data: bill });
  fireEvent.click(screen.getByRole("button", { name: "Save challans" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(updateBillChallans).toHaveBeenCalledWith(1, { version: "bill-version", challanIds: [1, 2],
    addedChallanVersions: { 2: "source-2" }, unitPrices: { 20: 3940 } });
});
it("allows explicit zero and replacement while preventing an empty bill", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Remove challan 12 record 1" }));
  expect(screen.getByRole("button", { name: "Save challans" }).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("Keep at least one item");
  fireEvent.click(screen.getByRole("button", { name: "Add challan 12 record 2" }));
  fireEvent.change(screen.getByLabelText("Unit rate for Item 20"), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "Save challans" }).disabled).toBe(false);
});
it("keeps selected items and rates across searches and failed saves", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Add challan 12 record 2" }));
  fireEvent.change(screen.getByLabelText("Unit rate for Item 20"), { target: { value: "3940" } });
  getBillChallans.mockResolvedValue({ data: { ...snapshot, available: [] } });
  fireEvent.change(screen.getByLabelText("Search challans"), { target: { value: "another PO" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(getBillChallans).toHaveBeenCalledWith(1, "another PO"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save challans" }).disabled).toBe(false));
  updateBillChallans.mockRejectedValue({ response: { data: { error: "Bill changed. Refresh it." } } });
  fireEvent.click(screen.getByRole("button", { name: "Save challans" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Bill changed. Refresh it.");
  expect(screen.getByLabelText("Unit rate for Item 20").value).toBe("3940");
});
it("previews the fresh snapshot when the parent bill is stale", async () => {
  getBillChallans.mockResolvedValue({ data: { ...snapshot, bill: { ...bill, items: [{ ...bill.items[0], lineTotal: 1000 }] } } });
  await open();
  expect(screen.getByText("New bill total: Rs 1,200.00")).toBeTruthy();
});

it("lets an empty historical link be removed while keeping standalone items", async () => {
  getBillChallans.mockResolvedValue({ data: { ...snapshot, linked: [{ ...source(1, 10), items: [] }],
    bill: { ...bill, items: [{ ...bill.items[0], deliveryItemId: null }] } } });
  await open();
  const remove = screen.getByRole("button", { name: "Remove challan 12 record 1" });
  expect(remove.disabled).toBe(false);
  fireEvent.click(remove);
  expect(screen.getByRole("button", { name: "Save challans" }).disabled).toBe(false);
});
