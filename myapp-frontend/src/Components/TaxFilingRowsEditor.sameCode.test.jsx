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
// An original-lines company gives each bill line its own HS code (2026-10-31): no selecting lines for
// one shared code, and a code already on one line is refused on another.
const withCodes = (original, codes) => { const p = payload(codes.map(() => 2)); p.data.bill.taxInvoiceUseOriginalBillLines = original;
  p.data.rows = p.data.rows.map((r, i) => ({ ...r, hsCode: codes[i], uom: "Pcs" })); return p; };
it("original lines: no line selection, and a code already on one line is refused on another", async () => {
  getTaxFiling.mockResolvedValueOnce(withCodes(true, ["8425.1100", "8204.1100", "8425.1100"]));
  render(<TaxFilingRowsEditor invoiceId={7} onClose={() => {}} />);
  await screen.findByTestId("hs-0");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /Apply to ticked/ })).toBeNull();
  const alerts = screen.getAllByRole("alert");
  expect(alerts).toHaveLength(1);
  expect(alerts[0].textContent).toBe("HS code 8425.1100 is already in use on bill line 1. Each bill line needs its own HS code.");
  expect(screen.getByRole("button", { name: "Save filing rows & complete review" }).disabled).toBe(true);
});
it("original lines: distinct codes save", async () => {
  getTaxFiling.mockResolvedValueOnce(withCodes(true, ["8425.1100", "8204.1100", "7318.1590"]));
  render(<TaxFilingRowsEditor invoiceId={7} onClose={() => {}} />);
  await screen.findByTestId("hs-0");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Save filing rows & complete review" }).disabled).toBe(false);
});
it("a grouping company may still use one code on several rows", async () => {
  getTaxFiling.mockResolvedValueOnce(withCodes(false, ["8425.1100", "8425.1100"]));
  render(<TaxFilingRowsEditor invoiceId={7} onClose={() => {}} />);
  await screen.findByTestId("hs-0");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Save filing rows & complete review" }).disabled).toBe(false);
});

const coded = (original, uom) => { const p = payload([4]); p.data.bill.taxInvoiceUseOriginalBillLines = original; p.data.rows[0] = { ...p.data.rows[0], hsCode: "8425.1100", uom }; return p; };
it("holds Save while FBR's unit for a typed code has not arrived", async () => {
  getTaxFiling.mockResolvedValueOnce(coded(true, ""));
  render(<TaxFilingRowsEditor invoiceId={7} onClose={() => {}} />);
  await screen.findByTestId("hs-0");
  const save = screen.getByRole("button", { name: /Loading FBR unit/ });
  expect(save.disabled).toBe(true);
});
it("allows Save once the unit is in", async () => {
  getTaxFiling.mockResolvedValueOnce(coded(true, "Pcs"));
  render(<TaxFilingRowsEditor invoiceId={7} onClose={() => {}} />);
  await screen.findByTestId("hs-0");
  expect(screen.getByRole("button", { name: "Save filing rows & complete review" }).disabled).toBe(false);
});
it("leaves a grouping company's Save button as it was", async () => {
  getTaxFiling.mockResolvedValueOnce(coded(false, ""));
  render(<TaxFilingRowsEditor invoiceId={7} onClose={() => {}} />);
  await screen.findByTestId("hs-0");
  expect(screen.getByRole("button", { name: "Save filing rows & complete review" }).disabled).toBe(false);
});
