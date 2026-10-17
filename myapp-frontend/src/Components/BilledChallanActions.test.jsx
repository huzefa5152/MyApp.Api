// @vitest-environment jsdom
import React from "react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
import PermissionsContext from "../contexts/PermissionsContext";
import ChallanList from "./ChallanList";
import ChallanTable from "./ChallanTable";
const permissions=new Set();
const row={id:1,companyId:2,challanNumber:10,invoiceId:7,status:"Invoiced",isEditable:true,clientName:"Sample buyer",items:[{id:3,description:"Goods",quantity:1,unit:"Pcs"}],deliveryDate:"2026-10-18"};
beforeEach(()=>{permissions.clear();permissions.add("challans.manage.update");permissions.add("bills.manage.update")});afterEach(cleanup);
for(const Component of [ChallanList,ChallanTable]){
 it(`${Component.name} opens the billed delivery action with both permissions`,()=>{const edit=vi.fn();render(<MemoryRouter><PermissionsContext.Provider value={{has:k=>permissions.has(k)}}><Component challans={[row]} onEditDelivery={edit}/></PermissionsContext.Provider></MemoryRouter>);fireEvent.click(screen.getByRole("button",{name:"Edit delivery & update bill"}));expect(edit).toHaveBeenCalledWith(row)});
 it(`${Component.name} hides delivery editing after FBR submission and without bill permission`,()=>{const view=render(<MemoryRouter><PermissionsContext.Provider value={{has:k=>permissions.has(k)}}><Component challans={[{...row,isEditable:false,invoiceFbrStatus:"Submitted"}]} onEditDelivery={()=>{}}/></PermissionsContext.Provider></MemoryRouter>);expect(screen.queryByRole("button",{name:"Edit delivery & update bill"})).toBeNull();view.unmount();permissions.delete("bills.manage.update");render(<MemoryRouter><PermissionsContext.Provider value={{has:k=>permissions.has(k)}}><Component challans={[row]} onEditDelivery={()=>{}}/></PermissionsContext.Provider></MemoryRouter>);expect(screen.queryByRole("button",{name:"Edit delivery & update bill"})).toBeNull()});
}
