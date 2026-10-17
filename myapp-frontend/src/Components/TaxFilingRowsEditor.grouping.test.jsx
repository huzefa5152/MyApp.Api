// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TaxFilingRowsEditor from "./TaxFilingRowsEditor";
import { getTaxFiling, saveTaxFiling } from "../api/invoiceApi";
vi.mock("../api/invoiceApi", () => ({ getTaxFiling: vi.fn(), saveTaxFiling: vi.fn() }));
vi.mock("../api/itemTypeApi", () => ({ getItemTypes: vi.fn().mockResolvedValue({ data: [] }) }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: () => true }) }));
vi.mock("./ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("./FilingClassificationFields", () => ({ default: ({ row, index, onChange }) => <button type="button" onClick={() => onChange({ ...row, itemTypeId: index + 1, hsCode: `111${index}.0000`, saleType: "Standard", uom: "Nos", description: "Filing supply" })}>Classify row {index + 1}</button> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const items = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, description: `Product ${i + 1}`, quantity: 1, lineTotal: 100, uom: "Nos" }));
const single = item => ({ sourceLineIds: [item.id], description: item.description, quantity: 1, valueExclTax: 100, uom: "Nos" });
function fixture(rows) {
  const data = { bill: { items, subtotal: 1000, companyId: 7, invoiceNumber: 42, isEditable: true }, rows, initialRows: rows, version: "version" };
  getTaxFiling.mockResolvedValue({ data }); saveTaxFiling.mockResolvedValue({ data }); return data;
}
it("groups ten unclassified lines into two filing rows and saves every source once", async () => {
  fixture(items.map(single)); render(<TaxFilingRowsEditor invoiceId={42} onClose={() => {}} />);
  await screen.findByText("10 FBR filing rows");
  for (let i = 1; i <= 5; i++) fireEvent.click(screen.getByLabelText(`Select filing row ${i}`));
  fireEvent.click(screen.getByText("Combine selected (5)"));
  expect(screen.getByText("6 FBR filing rows")).toBeTruthy();
  for (let i = 2; i <= 6; i++) fireEvent.click(screen.getByLabelText(`Select filing row ${i}`));
  fireEvent.click(screen.getByText("Combine selected (5)"));
  expect(screen.getByText("2 FBR filing rows")).toBeTruthy();
  fireEvent.click(screen.getByText("Classify row 1")); fireEvent.click(screen.getByText("Classify row 2"));
  fireEvent.click(screen.getByText("Save filing rows & complete review"));
  await vi.waitFor(() => expect(saveTaxFiling).toHaveBeenCalledOnce());
  const saved = saveTaxFiling.mock.calls[0][1].rows;
  expect(saved.map(r => r.sourceLineIds.length)).toEqual([5, 5]);
  expect(saved.map(r => r.valueExclTax)).toEqual([500, 500]);
  expect(saved.flatMap(r => r.sourceLineIds)).toEqual(items.map(i => i.id));
});
it("merges two suggested groups into one and can separate their source lines", async () => {
  fixture([0, 1].map(n => ({ ...single(items[n]), itemTypeId: n + 1, sourceLineIds: items.slice(n * 5, n * 5 + 5).map(i => i.id), quantity: 5, valueExclTax: 500 })));
  render(<TaxFilingRowsEditor invoiceId={42} onClose={() => {}} />);
  await screen.findByText("2 FBR filing rows"); fireEvent.click(screen.getByText("Select all rows")); fireEvent.click(screen.getByText("Combine selected (2)"));
  expect(screen.getByText("1 FBR filing row")).toBeTruthy();
  fireEvent.click(screen.getByText("Separate source lines"));
  expect(screen.getByText("10 FBR filing rows")).toBeTruthy();
  expect(items.every(i => i.quantity === 1 && i.lineTotal === 100)).toBe(true);
});
