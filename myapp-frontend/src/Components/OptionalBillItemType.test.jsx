// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ConfirmProvider from "./ConfirmDialog";
import InvoiceForm from "./InvoiceForm";
import StandaloneInvoiceForm from "./StandaloneInvoiceForm";
import http from "../api/httpClient";
vi.mock("../api/httpClient", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: () => true }) }));
vi.mock("./AttachmentManager", () => ({ default: () => null }));
const company = { id: 7, name: "Sample company", startingInvoiceNumber: 1 };
const lines = [{ id: 1, description: "Sample product", quantity: 2, unit: "Nos" }];
beforeEach(() => {
 http.get.mockImplementation(async url => ({ data: url.includes('/clients/') ? [{id:3,name:'Sample Buyer',registrationType:'Registered'}] : url.includes('/pending') ? [{id:10,challanNumber:10,clientId:3,status:'Pending',items:lines}] : url.includes('last-rates') ? [{deliveryItemId:1,lastUnitPrice:100}] : url.includes('next-number') ? {nextNumber:1} : url.includes('applicable') ? {scenarios:[{code:'SN001',saleType:'Goods at standard rate (default)',defaultRate:18}]} : [] }));
 http.post.mockImplementation(async (url, body) => ({data:{id:42,...body}}));
});
afterEach(() => {cleanup(); vi.clearAllMocks();});
function show(Component, extra = {}) {
 const saved = vi.fn();
 render(<MemoryRouter><ConfirmProvider><Component companyId={7} company={company} billsMode onClose={()=>{}} onSaved={saved} {...extra}/></ConfirmProvider></MemoryRouter>);
 return saved;
}
it('creates a challan bill without selecting any item type', async () => {
 const saved = show(InvoiceForm, {prefillChallanId:10});
 const button = await screen.findByRole('button',{name:/^Create Bill/});
 await vi.waitFor(() => expect(button.disabled).toBe(false));
 fireEvent.click(button);
 await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
 const request = http.post.mock.calls.find(([url])=>url==='/invoices')[1];
 expect(request.items[0]).toMatchObject({itemTypeId:null,unitPrice:100});
});
it('creates a standalone bill with a description and no item type', async () => {
 const saved=show(StandaloneInvoiceForm);
 fireEvent.click(await screen.findByRole('button',{name:'— Choose a buyer —',exact:true}));
 fireEvent.mouseDown(screen.getByText('Sample Buyer (Registered)',{exact:true}));
 fireEvent.change(await screen.findByPlaceholderText('Description'),{target:{value:'Sample service'}});
 fireEvent.change(screen.getByPlaceholderText('0'),{target:{value:'2'}});
 fireEvent.change(screen.getByPlaceholderText('Unit'),{target:{value:'Nos'}});
 fireEvent.change(screen.getAllByPlaceholderText('0.00')[0],{target:{value:'100'}});
 fireEvent.click(screen.getByRole('button',{name:/^Create Bill/}));
 await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
 const request=http.post.mock.calls.find(([url])=>url==='/invoices/standalone')[1];
 expect(request.items[0]).toMatchObject({itemTypeId:null,description:'Sample service',quantity:2,unitPrice:100});
});
