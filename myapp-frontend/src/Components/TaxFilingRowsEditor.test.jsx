// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TaxFilingRowsEditor from "./TaxFilingRowsEditor";
import { getItemTypes } from "../api/itemTypeApi";
import { getTaxFiling } from "../api/invoiceApi";
vi.mock("../api/invoiceApi", () => ({ getTaxFiling: vi.fn().mockResolvedValue({ data:{bill:{companyId:1,invoiceNumber:7,isEditable:true,subtotal:100,items:[]},rows:[{sourceLineIds:[],quantity:2,valueExclTax:100,uom:"Pcs",description:"Sample supply"}],initialRows:[]} }),saveTaxFiling:vi.fn() }));
vi.mock("../api/itemTypeApi", () => ({getItemTypes:vi.fn().mockResolvedValue({data:[]})}));
vi.mock("../contexts/PermissionsContext", () => ({usePermissions:()=>({has:()=>true})}));
vi.mock("./ConfirmDialog", () => ({useConfirm:()=>vi.fn()}));
vi.mock("./FilingClassificationFields", () => ({default:()=> <div>Classification picker</div>}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("preserves the consultant adjustment controls and guidance", async () => {
 render(<TaxFilingRowsEditor invoiceId={7} onClose={()=>{}} />);
 await screen.findByText("Classification picker");
 expect(screen.getByText(/Combine selected groups or classify each separately/)).toBeTruthy();
 // One row has nothing to combine, so no selection controls are offered.
 expect(screen.queryByRole("button",{name:/Combine selected/})).toBeNull();
 expect(screen.queryByRole("checkbox")).toBeNull();
 expect(screen.getByRole("button",{name:"Save filing rows & complete review"})).toBeTruthy();
 expect(screen.getByLabelText("Row 1 filing quantity")).toBeTruthy();
 expect(getItemTypes).toHaveBeenCalledWith(1);
});
it("uses a document view only for read-only invoices without fetching the edit catalog", async () => {
 render(<TaxFilingRowsEditor invoiceId={7} readOnly onClose={()=>{}} />);
 await screen.findByRole("table",{name:"Invoice items"});
 expect(screen.getByRole("heading",{name:"View Invoice · Invoice 7"})).toBeTruthy();
 expect(screen.queryByRole("spinbutton")).toBeNull();
 expect(screen.queryByRole("button",{name:/Combine selected/})).toBeNull();
 expect(getItemTypes).not.toHaveBeenCalled();
});
const line = (id, description) => ({ sourceLineIds:[id], quantity:1, valueExclTax:50, uom:"Pcs", description });
const twoLines = (original) => ({ data:{ bill:{ companyId:1, invoiceNumber:7, isEditable:true, subtotal:100, taxInvoiceUseOriginalBillLines:original, items:[{id:1,description:"First line",quantity:1,uom:"Pcs",lineTotal:50},{id:2,description:"Second line",quantity:1,uom:"Pcs",lineTotal:50}] }, rows:[line(1,"First line"), line(2,"Second line")], initialRows:[] } });
it("offers combining when there are several rows", async () => {
 getTaxFiling.mockResolvedValueOnce(twoLines(false));
 render(<TaxFilingRowsEditor invoiceId={7} onClose={()=>{}} />);
 await screen.findAllByText("Classification picker");
 expect(screen.getByRole("button",{name:"Combine selected (0)"})).toBeTruthy();
 expect(screen.getAllByRole("checkbox")).toHaveLength(2);
});
it("for a company that prints its original lines, shows each bill line and says how to combine", async () => {
 getTaxFiling.mockResolvedValueOnce(twoLines(true));
 render(<TaxFilingRowsEditor invoiceId={7} onClose={()=>{}} />);
 await screen.findAllByText("Classification picker");
 expect(screen.getByText(/Each row is one of your original bill lines/)).toBeTruthy();
 expect(screen.getByText("Bill line 1")).toBeTruthy();
 expect(screen.getByText("Bill line 2")).toBeTruthy();
 expect(screen.getByRole("button",{name:"Combine selected (0)"})).toBeTruthy();
});
