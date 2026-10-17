// @vitest-environment jsdom
import React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import PermissionsContext from "../contexts/PermissionsContext";
import ChallanList from "./ChallanList";
afterEach(cleanup);
const row={id:1,companyId:2,challanNumber:10,invoiceId:7,status:"Invoiced",isEditable:true,clientName:"Sample buyer",items:[{id:3,description:"Goods",quantity:1,unit:"Pcs"}],deliveryDate:"2026-10-18"};
it("keeps View and Print visible and puts billed edits and PDF in More",()=>{
 const edit=vi.fn(),pdf=vi.fn();render(<MemoryRouter><PermissionsContext.Provider value={{has:()=>true}}><ChallanList challans={[row]} onEditDelivery={edit} onExportPdf={pdf}/></PermissionsContext.Provider></MemoryRouter>);
 expect(screen.getByRole("button",{name:"View",exact:true})).toBeTruthy();expect(screen.getByRole("button",{name:"Print",exact:true})).toBeTruthy();
 expect(screen.queryByRole("button",{name:"Edit delivery & update bill"})).toBeNull();fireEvent.click(screen.getByRole("button",{name:"More actions"}));
 fireEvent.click(screen.getByRole("menuitem",{name:"Edit delivery & update bill"}));expect(edit).toHaveBeenCalledWith(row);expect(screen.queryByRole("menu")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"More actions"}));fireEvent.click(screen.getByRole("menuitem",{name:"PDF",exact:true}));expect(pdf).toHaveBeenCalledWith(row);
});
it("does not expose delivery editing after FBR submission",()=>{
 render(<MemoryRouter><PermissionsContext.Provider value={{has:()=>true}}><ChallanList challans={[{...row,isEditable:false,invoiceFbrStatus:"Submitted"}]} onEditDelivery={()=>{}} onExportPdf={()=>{}}/></PermissionsContext.Provider></MemoryRouter>);
 const more=screen.queryByRole("button",{name:"More actions"});if(more)fireEvent.click(more);expect(screen.queryByRole("menuitem",{name:"Edit delivery & update bill"})).toBeNull();
});
