// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TaxFilingRowsEditor from "./TaxFilingRowsEditor";
import { getTaxFiling } from "../api/invoiceApi";
vi.mock("../api/invoiceApi", () => ({ getTaxFiling: vi.fn(), saveTaxFiling: vi.fn() }));
vi.mock("../api/itemTypeApi", () => ({ getItemTypes: vi.fn().mockResolvedValue({ data: [] }) }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: () => true }) }));
vi.mock("./ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
// The bulk picker is the one given a label; row pickers just show what the row holds.
vi.mock("./FilingClassificationFields", () => ({ default: ({ row, index, label, onChange }) => label
  ? <button type="button" onClick={() => onChange({ ...row, hsCode: "8425.1100", itemTypeId: 5, description: "Hoists", uom: "Pcs", fbrUOMId: 3, saleType: "Goods at standard rate (default)" })}>Choose shared code</button>
  : <div data-testid={`hs-${index}`}>{row.hsCode || "none"}</div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const row = (id, qty) => ({ sourceLineIds: [id], quantity: qty, valueExclTax: qty * 100, uom: "Pcs", description: `Line ${id}` });
const item = (id, qty) => ({ id, description: `Line ${id}`, quantity: qty, uom: "Pcs", unitPrice: 100, lineTotal: qty * 100 });
const payload = (lines) => ({ data: { bill: { companyId: 1, invoiceNumber: 7, isEditable: true, subtotal: lines.reduce((n, q) => n + q * 100, 0), taxInvoiceUseOriginalBillLines: true,
  items: lines.map((q, i) => item(i + 1, q)) }, rows: lines.map((q, i) => row(i + 1, q)), initialRows: [] } });

it("a single original line shows what was billed and asks only for the code and quantity", async () => {
  getTaxFiling.mockResolvedValueOnce(payload([4]));
  render(<TaxFilingRowsEditor invoiceId={7} onClose={() => {}} />);
  await screen.findByTestId("hs-0");
  expect(screen.getByText(/Original bill line: 4 Pcs × Rs. 100.00 = Rs. 400.00/)).toBeTruthy();
  expect(screen.getByText(/This is your original bill line/)).toBeTruthy();
  expect(screen.getByText("Stays as billed")).toBeTruthy();
  expect(screen.queryByLabelText(/amount excluding tax/i)).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText("Same HS code on several lines")).toBeNull();
});
it("one code can be applied to several ticked lines, which stay separate with their own quantities", async () => {
  getTaxFiling.mockResolvedValueOnce(payload([4, 6, 2]));
  render(<TaxFilingRowsEditor invoiceId={7} onClose={() => {}} />);
  await screen.findByTestId("hs-0");
  const apply = () => screen.getByRole("button", { name: /Apply to ticked lines/ });
  expect(apply().disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Choose shared code" }));
  fireEvent.click(screen.getByLabelText("Select filing row 1"));
  fireEvent.click(screen.getByLabelText("Select filing row 3"));
  expect(apply().disabled).toBe(false);
  fireEvent.click(apply());
  expect(screen.getByTestId("hs-0").textContent).toBe("8425.1100");
  expect(screen.getByTestId("hs-1").textContent).toBe("none");
  expect(screen.getByTestId("hs-2").textContent).toBe("8425.1100");
  expect(screen.getAllByText(/^Bill line \d$/)).toHaveLength(3);
  expect(screen.getByLabelText("Row 1 filing quantity").value).toBe("4");
  expect(screen.getByLabelText("Row 3 filing quantity").value).toBe("2");
});
