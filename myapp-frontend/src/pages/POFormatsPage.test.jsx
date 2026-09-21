// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import POFormatsPage from "./POFormatsPage";
import POFormatForm from "../Components/POFormatForm";
import * as api from "../api/poFormatApi";
const state = vi.hoisted(() => ({ companies: [], selectedCompany: null, allowed: new Set(), setSelectedCompany: vi.fn() }));
vi.mock("../contexts/CompanyContext", () => ({ useCompany: () => state }));
vi.mock("../contexts/PermissionsContext", () => ({ usePermissions: () => ({ has: key => state.allowed.has(key) }) }));
vi.mock("../Components/ConfirmDialog", () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock("../api/poFormatApi", () => ({ listPoFormats:vi.fn(),getPoFormat:vi.fn(),deletePoFormat:vi.fn(),getPoFormatClients:vi.fn(),fingerprintPdf:vi.fn(),createPoFormatSimple:vi.fn(),updatePoFormatSimple:vi.fn() }));
const a={id:1,name:"Company A"},b={id:2,name:"Company B"};
const row=(id,name,clientId=11)=>({id,name,clientId,clientName:"A client",companyId:1,isActive:true,currentVersion:1,updatedAt:"2026-09-21",ruleSetJson:JSON.stringify({engine:"simple-headers-v1",descriptionHeader:"Description",quantityHeader:"Quantity"})});
beforeEach(()=>{
  vi.resetAllMocks();
  state.companies=[a];state.selectedCompany=a;
  state.allowed=new Set(["poformats.manage.view","poformats.manage.create","poformats.manage.update","poformats.manage.delete"]);
  api.listPoFormats.mockResolvedValue({data:[]});
  api.getPoFormatClients.mockResolvedValue({data:[{id:11,name:"A client"},{id:12,name:"Other A"}]});
  api.fingerprintPdf.mockResolvedValue({data:{rawText:"Description Quantity",matchedFormat:null}});
  Element.prototype.scrollIntoView=vi.fn();
});
afterEach(cleanup);
describe("company-private PO formats",()=>{
  it("restricted users see only granted company options and scoped requests",async()=>{
    render(<POFormatsPage/>);
    await waitFor(()=>expect(api.listPoFormats).toHaveBeenCalledWith({companyId:1}));
    expect(within(screen.getByLabelText("Company")).getAllByRole("option").map(x=>x.textContent)).toEqual(["Company A"]);
    expect(screen.queryByText(/across ALL companies/)).toBeNull();
  });
  it("seed admin can select any supplied company",async()=>{
    state.companies=[a,b];render(<POFormatsPage/>);
    fireEvent.change(screen.getByLabelText("Company"),{target:{value:"2"}});
    expect(state.setSelectedCompany).toHaveBeenCalledWith(b);
    expect(within(screen.getByLabelText("Company")).getAllByRole("option")).toHaveLength(2);
  });
  it("changing company closes the editor and clears old formats",async()=>{
    api.listPoFormats.mockImplementation(({companyId})=>Promise.resolve({data:companyId===1?[row(1,"A private")]:[row(2,"B private",22)]}));
    api.getPoFormat.mockResolvedValue({data:row(1,"A private")});
    const ui=render(<POFormatsPage/>);
    await screen.findAllByText("A private");
    fireEvent.click(screen.getByTitle("Edit"));
    await screen.findByText("Edit PO Format");
    state.selectedCompany=b;state.companies=[a,b];ui.rerender(<POFormatsPage/>);
    await screen.findAllByText("B private");
    expect(screen.queryByText("Edit PO Format")).toBeNull();
    expect(screen.queryByText("A private")).toBeNull();
  });
  it("a late response from the old company cannot replace the new list",async()=>{
    let finish;
    api.listPoFormats.mockImplementation(({companyId})=>companyId===1?new Promise(r=>{finish=r;}):Promise.resolve({data:[row(2,"B private")]}));
    const ui=render(<POFormatsPage/>);
    state.selectedCompany=b;ui.rerender(<POFormatsPage/>);
    await screen.findAllByText("B private");
    await act(async()=>finish({data:[row(1,"A late")]}));
    expect(screen.queryByText("A late")).toBeNull();
    expect(screen.getAllByText("B private").length).toBeGreaterThan(0);
  });
  it("read-only users cannot see create edit or delete controls",async()=>{
    state.allowed=new Set(["poformats.manage.view"]);api.listPoFormats.mockResolvedValue({data:[row(1,"A private")]});
    render(<POFormatsPage/>);await screen.findAllByText("A private");
    expect(screen.queryByRole("button",{name:/Add/})).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();expect(screen.queryByTitle("Delete")).toBeNull();
  });
  it("no company access makes no format request",()=>{
    state.selectedCompany=null;state.companies=[];render(<POFormatsPage/>);
    expect(api.listPoFormats).not.toHaveBeenCalled();expect(screen.getByText(/No company access/)).toBeTruthy();
  });
  it("picker loads company clients and hides clients already bound there",async()=>{
    api.listPoFormats.mockResolvedValue({data:[row(1,"Existing",11)]});
    render(<POFormatForm companyId={1} companyName="Company A" onClose={()=>{}} onSaved={()=>{}}/>);
    await screen.findByRole("option",{name:"Other A"});
    expect(api.getPoFormatClients).toHaveBeenCalledWith(1);
    expect(api.listPoFormats).toHaveBeenCalledWith({companyId:1});
    expect(screen.queryByRole("option",{name:"A client"})).toBeNull();
  });
  it("create upload and save both carry the selected company",async()=>{
    const saved=vi.fn();api.createPoFormatSimple.mockResolvedValue({});
    const ui=render(<POFormatForm companyId={1} companyName="Company A" onClose={()=>{}} onSaved={saved}/>);
    await screen.findByRole("option",{name:"A client"});
    fireEvent.change(screen.getByLabelText("Client *"),{target:{value:"11"}});
    const file=new File(["sample"],"sample.pdf",{type:"application/pdf"});
    fireEvent.change(ui.container.querySelector('input[type="file"]'),{target:{files:[file]}});
    await waitFor(()=>expect(api.fingerprintPdf).toHaveBeenCalledWith(file,1));
    fireEvent.change(screen.getByPlaceholderText('e.g. "Item Name"'),{target:{value:"Description"}});
    fireEvent.change(screen.getByPlaceholderText('e.g. "Quantity" or "Qty"'),{target:{value:"Quantity"}});
    await waitFor(()=>expect(screen.getByRole("button",{name:"Save PO Format"}).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button",{name:"Save PO Format"}));
    await waitFor(()=>expect(api.createPoFormatSimple).toHaveBeenCalledWith(expect.objectContaining({companyId:1,clientId:11})));
    expect(saved).toHaveBeenCalled();
  });
  it("edit preserves current client and submits only an available company client",async()=>{
    const format=row(1,"A private");api.listPoFormats.mockResolvedValue({data:[format]});api.updatePoFormatSimple.mockResolvedValue({});
    render(<POFormatForm format={format} companyId={1} companyName="Company A" onClose={()=>{}} onSaved={()=>{}}/>);
    await screen.findByRole("option",{name:"A client"});expect(screen.getByLabelText("Client *").value).toBe("11");
    fireEvent.change(screen.getByLabelText("Client *"),{target:{value:"12"}});
    fireEvent.click(screen.getByRole("button",{name:"Save changes"}));
    await waitFor(()=>expect(api.updatePoFormatSimple).toHaveBeenCalledWith(1,expect.objectContaining({clientId:12})));
  });
  it("failed client lookup fails closed and leaves save disabled",async()=>{
    api.getPoFormatClients.mockRejectedValue(new Error("Forbidden"));
    render(<POFormatForm companyId={1} companyName="Company A" onClose={()=>{}} onSaved={()=>{}}/>);
    await screen.findByText(/Unable to load this company's clients/);
    expect(screen.getByRole("button",{name:"Save PO Format"}).disabled).toBe(true);
    expect(api.createPoFormatSimple).not.toHaveBeenCalled();
  });
});
