// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PaymentForm from "./PaymentForm";
import BankCashSelect from "./BankCashSelect";
import { mergeTemplate } from "../utils/templateEngine";
import { defaultReceiptTemplate, defaultPaymentTemplate } from "../utils/accountingDocTemplates";
import { getBankCashAccounts, getCoaTree, createAccount } from "../api/accountApi";
import { getPagedInvoicesByCompany, getInvoiceById } from "../api/invoiceApi";
import { getPurchaseBillsByCompanyPaged, getPurchaseBillById } from "../api/purchaseBillApi";
import { createPayment, updatePayment } from "../api/paymentApi";
const access = vi.hoisted(() => ({ allowed: true }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: () => access.allowed }) }));
vi.mock("../api/accountApi", () => ({ getAccountsFlat: vi.fn().mockResolvedValue({data:[]}), getBankCashAccounts: vi.fn(), getCoaTree: vi.fn(), createAccount: vi.fn() }));
vi.mock("../api/clientApi", () => ({ getClientsByCompany: vi.fn().mockResolvedValue({data:[{id:71,name:"Sample buyer"}]}) }));
vi.mock("../api/supplierApi", () => ({ getSuppliersByCompany: vi.fn().mockResolvedValue({data:[{id:72,name:"Sample supplier"}]}) }));
vi.mock("../api/invoiceApi", () => ({ getInvoiceById: vi.fn(), getPagedInvoicesByCompany: vi.fn().mockResolvedValue({data:{items:[{id:81,invoiceNumber:101,grandTotal:100,balanceDue:100}]}}) }));
vi.mock("../api/purchaseBillApi", () => ({ getPurchaseBillById: vi.fn(), getPurchaseBillsByCompanyPaged: vi.fn().mockResolvedValue({data:{items:[{id:82,purchaseBillNumber:102,grandTotal:100,balanceDue:100}]}}) }));
vi.mock("../api/paymentApi", () => ({ createPayment: vi.fn(), updatePayment: vi.fn() }));
vi.mock("./AttachmentManager", () => ({default: () => null}));
vi.mock("./DocumentNotesEditor", () => ({default: () => null}));
vi.mock("../utils/notify", () => ({notify: vi.fn()}));
afterEach(() => { cleanup(); window.innerWidth = 1024; });
beforeEach(() => {
 vi.clearAllMocks(); access.allowed = true;
 getPagedInvoicesByCompany.mockResolvedValue({data:{items:[{id:81,invoiceNumber:101,grandTotal:100,balanceDue:100}]}});
 getPurchaseBillsByCompanyPaged.mockResolvedValue({data:{items:[{id:82,purchaseBillNumber:102,grandTotal:100,balanceDue:100}]}});
 getBankCashAccounts.mockResolvedValue({data:[{id:1,name:"Sample bank",accountGroupId:3}]});
 getCoaTree.mockResolvedValue({data:{balanceSheet:[{id:3,name:"Cash and bank",children:[]}]}});
 createAccount.mockResolvedValue({data:{id:2,name:"Sample cash",accountGroupId:3}});
 createPayment.mockResolvedValue({data:{id:9}}); updatePayment.mockResolvedValue({data:{id:9}});
});
it.each(["receipts", "payments"])("creates and selects an account without submitting or losing the %s draft", async mode => {
 render(<PaymentForm mode={mode} companyId={42} preset={{contactId:mode === "receipts" ? 71 : 72, documentId:mode === "receipts" ? 81 : 82}} onClose={vi.fn()} />);
 await screen.findByText("Sample bank");
 fireEvent.change(screen.getByRole("spinbutton", {name:"Additional amount on account"}), {target:{value:"25"}});
 fireEvent.click(screen.getByRole("button", {name:/new bank\/cash account/i}));
 const name = await screen.findByPlaceholderText("Bank current account or cash account");
 fireEvent.change(name, {target:{value:"Sample cash"}});
 fireEvent.submit(name.closest("form"));
 await screen.findByText("Sample cash");
 expect(createAccount).toHaveBeenCalledWith(42,expect.objectContaining({name:"Sample cash",controlType:"BankCash",openingBalance:0}));
 expect(createPayment).not.toHaveBeenCalled();
 expect(screen.getByRole("spinbutton",{name:"Additional amount on account"}).value).toBe("25");
 fireEvent.click(screen.getByRole("button", {name:mode === "receipts" ? "Save Receipt" : "Save Payment"}));
 await waitFor(() => expect(createPayment).toHaveBeenCalledWith(mode,42,expect.objectContaining({bankAccountId:2,allocations:expect.arrayContaining([expect.objectContaining({kind:"OnAccount",amount:25}),expect.objectContaining({kind:"Document",amount:100})])})));
});
it("does not substitute free text or enable saving after an account request fails", async () => {
 getBankCashAccounts.mockRejectedValue(new Error("Forbidden"));
 render(<PaymentForm mode="receipts" companyId={42} preset={{contactId:71,documentId:81}} />);
 expect(await screen.findByText(/could not load bank\/cash accounts/i)).toBeTruthy();
 expect(screen.queryByPlaceholderText("Bank current account or cash account")).toBeNull();
 expect(screen.getByRole("button",{name:"Save Receipt"}).disabled).toBe(true);
 getBankCashAccounts.mockResolvedValue({data:[{id:1,name:"Sample bank"}]});
 fireEvent.click(screen.getByRole("button",{name:"Retry"}));
 await screen.findByText("Sample bank");
 await waitFor(() => expect(screen.getByRole("button",{name:"Save Receipt"}).disabled).toBe(false));
});
it("hides account creation without chart management permission", async () => {
 access.allowed=false;
 render(<BankCashSelect companyId={42} value="" onChange={vi.fn()} />);
 await screen.findByRole("button",{name:/select account/i});
 expect(screen.queryByRole("button",{name:/new bank\/cash account/i})).toBeNull();
});
it("discards a previous company's account response", async () => {
 let finish; getBankCashAccounts.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
 const changed=vi.fn();
 function Picker({companyId}) { const [value,setValue]=React.useState(""); return <BankCashSelect companyId={companyId} value={value} autoSelectSingle onChange={(id,name) => {changed(id,name);setValue(id);}} />; }
 const view=render(<Picker companyId={42} />);
 view.rerender(<Picker companyId={99} />);
 await screen.findByText("Sample bank");
 finish({data:[{id:98,name:"Foreign stale account"}]});
 await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
 expect(screen.queryByText("Foreign stale account")).toBeNull();
});
it("preserves cleared cheque status and mixed allocations when editing", async () => {
 render(<PaymentForm mode="receipts" companyId={42} editPayment={{id:9,contactType:"Client",contactId:71,bankAccountId:1,method:"Cheque",chequeNumber:"SAMPLE-1",chequeStatus:"Cleared",allocations:[{kind:"Document",invoiceId:81,amount:20},{kind:"OnAccount",amount:5}]}} />);
 await screen.findByText("Sample bank");
 await waitFor(() => expect(screen.getByRole("button",{name:"Save Changes"}).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button",{name:"Save Changes"}));
 await waitFor(() => expect(updatePayment).toHaveBeenCalledWith("receipts",9,expect.objectContaining({chequeStatus:"Cleared",allocations:expect.arrayContaining([expect.objectContaining({invoiceId:81,amount:20}),expect.objectContaining({kind:"OnAccount",amount:5})])})));
});

it("cancelling account creation preserves the parent draft", async () => {
 render(<PaymentForm mode="receipts" companyId={42} preset={{contactId:71,documentId:81}} />);
 await screen.findByText("Sample bank");
 fireEvent.change(screen.getByRole("spinbutton",{name:"Additional amount on account"}),{target:{value:"25"}});
 fireEvent.click(screen.getByRole("button",{name:/new bank\/cash account/i}));
 const dialog=await screen.findByRole("dialog",{name:"New Bank / Cash Account"});
 fireEvent.click(within(dialog).getByRole("button",{name:"Cancel",exact:true}));
 expect(screen.queryByRole("dialog",{name:"New Bank / Cash Account"})).toBeNull();
 expect(screen.getByRole("spinbutton",{name:"Additional amount on account"}).value).toBe("25");
 expect(createAccount).not.toHaveBeenCalled(); expect(createPayment).not.toHaveBeenCalled();
});
it.each([["Receipt",defaultReceiptTemplate],["Payment",defaultPaymentTemplate]])("built-in %s voucher renders mixed allocations and totals", (direction,template) => {
 const html=mergeTemplate(template,{direction,reference:"SAMPLE-001",companyBrandName:"Sample company",date:"2026-10-12",contactName:"Sample counterparty",method:"Cash",amount:125,amountInWords:"One hundred twenty five",allocations:[{sNo:1,documentLabel:"Invoice #101",amount:100},{sNo:2,documentLabel:"Advance / on account",amount:25}]});
 expect(html).toContain("Sample counterparty"); expect(html).toContain("Invoice #101"); expect(html).toContain("Advance / on account"); expect(html).toContain("125"); expect(html).not.toContain("NaN");
});

it.each(["receipts", "payments"])("groups saved allocations before remaining documents without losing hidden or searched %s amounts", async mode => {
 const receipt = mode === "receipts", ownId = receipt ? 81 : 82;
 const numberKey = receipt ? "invoiceNumber" : "purchaseBillNumber", docKey = receipt ? "invoiceId" : "purchaseBillId";
 const load = receipt ? getPagedInvoicesByCompany : getPurchaseBillsByCompanyPaged;
 load.mockResolvedValue({data:{items:[{id:ownId,[numberKey]:101,grandTotal:100,balanceDue:0},{id:83,[numberKey]:103,grandTotal:200,balanceDue:200},{id:84,[numberKey]:104,grandTotal:50,balanceDue:0}]}});
 render(<PaymentForm mode={mode} companyId={42} editPayment={{id:9,contactType:receipt ? "Client" : "Supplier",contactId:receipt ? 71 : 72,bankAccountId:1,allocations:[{kind:"Document",[docKey]:ownId,amount:95,adjustmentAmount:5},{kind:"OnAccount",amount:25}]}} />);
 const toggle = await screen.findByRole("button",{name:/already allocated to this/});
 const saved = screen.getByRole("region",{name:/Already allocated/}), remaining = screen.getByRole("region",{name:/Remaining unpaid/});
 expect(within(saved).getByText("#101")).toBeTruthy();
 expect(within(saved).getByText(/Originally.*95.*5 adjustment/)).toBeTruthy();
 expect(within(remaining).getByText("#103")).toBeTruthy();
 expect(within(remaining).queryByText("#101")).toBeNull(); expect(screen.queryByText("#104")).toBeNull();
 fireEvent.click(toggle);
 expect(toggle.getAttribute("aria-expanded")).toBe("false");
 expect(document.getElementById(toggle.getAttribute("aria-controls")).hidden).toBe(true);
 fireEvent.change(screen.getByRole("searchbox"),{target:{value:"103"}});
 fireEvent.change(within(remaining).getByRole("spinbutton",{name:/for.*#103/}),{target:{value:"20"}});
 fireEvent.click(screen.getByRole("button",{name:"Save Changes"}));
 await waitFor(() => expect(updatePayment).toHaveBeenCalledWith(mode,9,expect.objectContaining({allocations:expect.arrayContaining([expect.objectContaining({[docKey]:ownId,amount:95,adjustmentAmount:5}),expect.objectContaining({[docKey]:83,amount:20}),expect.objectContaining({kind:"OnAccount",amount:25})])})));
});
it.each(["receipts", "payments"])("loads an existing %s allocation absent from the party list", async mode => {
 const receipt = mode === "receipts", lookup = receipt ? getInvoiceById : getPurchaseBillById, docKey = receipt ? "invoiceId" : "purchaseBillId";
 lookup.mockResolvedValue({data:{id:90,companyId:42,[receipt ? "invoiceNumber" : "purchaseBillNumber"]:190,grandTotal:75,balanceDue:0}});
 render(<PaymentForm mode={mode} companyId={42} editPayment={{id:9,contactType:receipt ? "Client" : "Supplier",contactId:receipt ? 71 : 72,bankAccountId:1,allocations:[{kind:"Document",[docKey]:90,amount:75}]}} />);
 await screen.findByText("#190"); expect(lookup).toHaveBeenCalledWith(90);
 fireEvent.click(screen.getByRole("button",{name:"Save Changes"}));
 await waitFor(() => expect(updatePayment).toHaveBeenCalledWith(mode,9,expect.objectContaining({allocations:[expect.objectContaining({[docKey]:90,amount:75})]})));
});
it("blocks saving when an existing allocated document cannot be loaded", async () => {
 getInvoiceById.mockRejectedValue(new Error("Unavailable"));
 render(<PaymentForm mode="receipts" companyId={42} editPayment={{id:9,contactType:"Client",contactId:71,bankAccountId:1,allocations:[{kind:"Document",invoiceId:90,amount:75},{kind:"OnAccount",amount:25}]}} />);
 await screen.findByRole("alert"); expect(screen.getByRole("button",{name:"Save Changes"}).disabled).toBe(true);
 fireEvent.submit(screen.getByRole("button",{name:"Save Changes"}).closest("form")); expect(updatePayment).not.toHaveBeenCalled();
});

it.each(["receipts", "payments"])("keeps applied and remaining %s amounts editable on phones", async mode => {
 window.innerWidth = 375;
 const receipt = mode === "receipts", id = receipt ? 81 : 82, docKey = receipt ? "invoiceId" : "purchaseBillId", numberKey = receipt ? "invoiceNumber" : "purchaseBillNumber";
 (receipt ? getPagedInvoicesByCompany : getPurchaseBillsByCompanyPaged).mockResolvedValue({data:{items:[{id,[numberKey]:101,grandTotal:100,balanceDue:80},{id:83,[numberKey]:103,grandTotal:50,balanceDue:50}]}});
 render(<PaymentForm mode={mode} companyId={42} editPayment={{id:9,contactType:receipt ? "Client" : "Supplier",contactId:receipt ? 71 : 72,bankAccountId:1,allocations:[{kind:"Document",[docKey]:id,amount:20}]}} />);
 const toggle=await screen.findByRole("button",{name:/already allocated to this/});
 expect(screen.queryByRole("table")).toBeNull();
 fireEvent.change(screen.getByRole("spinbutton",{name:/for.*#101/}),{target:{value:"15"}});
 fireEvent.click(toggle); fireEvent.click(toggle);
 expect(screen.getByRole("spinbutton",{name:/for.*#101/}).value).toBe("15");
 fireEvent.change(screen.getByRole("spinbutton",{name:/for.*#103/}),{target:{value:"5"}});
 fireEvent.click(screen.getByRole("button",{name:"Save Changes"}));
 await waitFor(() => expect(updatePayment).toHaveBeenCalledWith(mode,9,expect.objectContaining({allocations:expect.arrayContaining([expect.objectContaining({[docKey]:id,amount:15}),expect.objectContaining({[docKey]:83,amount:5})])})));
});
