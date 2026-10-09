// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PaymentForm from "./PaymentForm";
import { getClientsByCompany } from "../api/clientApi";
vi.mock("../api/clientApi", () => ({ getClientsByCompany: vi.fn() }));
vi.mock("../api/supplierApi", () => ({ getSuppliersByCompany: vi.fn().mockResolvedValue({data:[]}) }));
vi.mock("../api/accountApi", () => ({ getAccountsFlat: vi.fn().mockResolvedValue({data:[]}), getBankCashAccounts: vi.fn().mockResolvedValue({data:[]}) }));
vi.mock("../api/invoiceApi", () => ({ getPagedInvoicesByCompany: vi.fn().mockResolvedValue({data:{items:[]}}) }));
vi.mock("../api/purchaseBillApi", () => ({ getPurchaseBillsByCompanyPaged: vi.fn().mockResolvedValue({data:{items:[]}}) }));
vi.mock("./AttachmentManager", () => ({default: () => null}));
vi.mock("./DocumentNotesEditor", () => ({default: () => null}));
vi.mock("./DivisionSelect", () => ({default: () => null}));
vi.mock("./BankCashSelect", () => ({default: () => null}));
vi.mock("./AccountSelect", () => ({default: () => null}));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); getClientsByCompany.mockResolvedValue({data:[{id:71,name:"Selected company client"}]}); });
it("renders returned company clients in the real searchable picker", async () => {
 render(<PaymentForm mode="receipts" companyId={42} onClose={() => {}} onSaved={() => {}} />);
 await waitFor(() => expect(getClientsByCompany).toHaveBeenCalledWith(42));
 const picker=await screen.findByRole("button", {name:/select client/i});
 await waitFor(() => expect(picker.disabled).toBe(false));
 fireEvent.click(picker);
 expect(await screen.findByText("Selected company client")).toBeTruthy();
});
it("reports a rejected client request without showing another company list", async () => {
 getClientsByCompany.mockRejectedValue(new Error("Forbidden"));
 render(<PaymentForm mode="receipts" companyId={99} onClose={() => {}} onSaved={() => {}} />);
 expect(await screen.findByRole("alert")).toBeTruthy();
 expect(screen.queryByText("Selected company client")).toBeNull();
 expect(getClientsByCompany).toHaveBeenCalledWith(99);
});
