// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ChallanPrivateCosts from "./ChallanPrivateCosts";

vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: () => true }) }));
vi.mock("../api/supplierApi", () => ({ getSuppliersByCompany: vi.fn(async () => ({ data: [] })) }));
vi.mock("../api/companyApi", () => ({ getCompanyById: vi.fn() }));
vi.mock("./SearchableSelect", () => ({ default: ({ value, onChange, placeholder }) =>
  <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)}><option value="">-</option><option value="5">A</option><option value="6">B</option></select> }));
afterEach(cleanup);
const suppliers = [{ id: 5, name: "A" }, { id: 6, name: "B" }];

it("explains that saving books costed lines", () => {
  render(<ChallanPrivateCosts companyId={1} suppliers={suppliers} items={[{ id: 1, description: "Pipe", quantity: 2 }]} onItemsChange={() => {}} />);
  expect(screen.getByText(/Saving books every line that has a supplier and a cost/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add supplier for line 1" })).toBeTruthy();
});

it("keeps a fully paid line read-only and out of apply-to-all", () => {
  const onItemsChange = vi.fn();
  const items = [
    { id: 1, description: "Paid pipe", quantity: 2, supplierId: 5, supplierName: "A", actualUnitCost: 10, lockedPurchaseQuantity: 2 },
    { id: 2, description: "Open valve", quantity: 3, supplierId: null, actualUnitCost: null, lockedPurchaseQuantity: 1 },
  ];
  render(<ChallanPrivateCosts companyId={1} suppliers={suppliers} items={items} onItemsChange={onItemsChange} />);
  expect(screen.getByText(/On a paid or entered supplier bill/)).toBeTruthy();
  expect(screen.getByText(/1 on a paid or entered supplier bill; the rest follows this cost/)).toBeTruthy();
  expect(screen.queryByLabelText("Actual cost per unit for line 1")).toBeNull();
  expect(screen.getByLabelText("Actual cost per unit for line 2")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add supplier for line 1" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Apply supplier to all"), { target: { value: "6" } });
  expect(onItemsChange).toHaveBeenCalledWith([items[0], { ...items[1], supplierId: 6 }]);
});
