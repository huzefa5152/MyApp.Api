// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import TaxFilingRowsEditor from "./TaxFilingRowsEditor";
import { getItemTypes } from "../api/itemTypeApi";
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
 expect(screen.getByRole("button",{name:"Combine selected (0)"})).toBeTruthy();
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
