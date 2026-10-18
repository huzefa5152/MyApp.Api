// @vitest-environment jsdom
import React from 'react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import StockEntryForm from './StockEntryForm';
import http from '../api/httpClient';
const state=vi.hoisted(()=>({has:()=>true}));
vi.mock('../contexts/PermissionsContext',()=>({usePermissions:()=>({has:state.has})}));
vi.mock('./ConfirmDialog',()=>({useConfirm:()=>async()=>true}));
vi.mock('../api/httpClient',()=>({default:{get:vi.fn(),post:vi.fn()}}));
vi.mock('./SearchableItemTypeSelect',()=>({default:({onChange})=><button type="button" onClick={()=>onChange(3)}>Choose sample item</button>}));
const options={trackingEnabled:true,items:[{id:3,name:'Sample stock',uom:'Pcs',currentQuantity:10,unitCost:20}]};
beforeEach(()=>{state.has=()=>true;vi.clearAllMocks();http.get.mockImplementation(url=>Promise.resolve({data:url.includes('/items')?options:[]}));http.post.mockResolvedValue({data:{id:5}});});
afterEach(cleanup);
function show(){render(<StockEntryForm companyId={7} onClose={()=>{}} onBack={()=>{}}/>);}
async function enter(){await screen.findByRole('button',{name:'Choose sample item'});fireEvent.click(screen.getByRole('button',{name:'Choose sample item'}));fireEvent.change(screen.getByLabelText('Stock quantity'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Stock unit cost'),{target:{value:'20'}});fireEvent.change(screen.getByLabelText('Stock entry reason'),{target:{value:'Sample opening'}});}
it('records opening stock without supplier or tax fields',async()=>{show();await enter();expect(screen.queryByLabelText(/Supplier/)).toBeNull();expect(screen.queryByLabelText(/GST/)).toBeNull();expect(screen.getByRole('region',{name:'Stock entry preview'}).textContent).toContain('After 12');fireEvent.click(screen.getByRole('button',{name:'Record stock entry'}));await waitFor(()=>expect(http.post).toHaveBeenCalled());expect(http.post.mock.calls[0][1]).toMatchObject({companyId:7,itemTypeId:3,kind:'Opening',quantityDelta:2,unitCost:20,reason:'Sample opening'});});
it('reductions use signed quantity and server-derived cost',async()=>{show();await enter();fireEvent.change(screen.getByLabelText('Entry type'),{target:{value:'Adjustment'}});fireEvent.change(screen.getByLabelText('Stock movement'),{target:{value:'remove'}});expect(screen.getByLabelText('Stock unit cost').readOnly).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Record stock entry'}));await waitFor(()=>expect(http.post).toHaveBeenCalled());expect(http.post.mock.calls[0][1]).toMatchObject({kind:'Adjustment',quantityDelta:-2,unitCost:0});});
it('preserves the request key when a failed request is retried',async()=>{http.post.mockRejectedValueOnce(new Error('network'));show();await enter();fireEvent.click(screen.getByRole('button',{name:'Record stock entry'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Record stock entry'}));await waitFor(()=>expect(http.post).toHaveBeenCalledTimes(2));expect(http.post.mock.calls[0][1].requestId).toBe(http.post.mock.calls[1][1].requestId);});
it('does not submit missing fields',async()=>{show();await screen.findByRole('button',{name:'Choose sample item'});fireEvent.click(screen.getByRole('button',{name:'Record stock entry'}));expect(await screen.findByRole('alert')).toBeTruthy();expect(http.post).not.toHaveBeenCalled();});
it('does not offer opening stock without permission',async()=>{state.has=k=>k==='stock.adjust.create';show();await screen.findByRole('button',{name:'Choose sample item'});expect(screen.queryByRole('option',{name:'Opening stock'})).toBeNull();expect(screen.getByLabelText('Entry type').value).toBe('Adjustment');});
it('requires tracking before recording a stock entry',async()=>{http.get.mockImplementation(url=>Promise.resolve({data:url.includes('/items')?{...options,trackingEnabled:false}:[]}));show();await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Record stock entry'}).disabled).toBe(true);});
it('reverses a listed entry through its own endpoint',async()=>{http.get.mockImplementation(url=>Promise.resolve({data:url.includes('/items')?options:[{id:9,itemName:'Sample stock',kind:'Opening',quantityDelta:5,uom:'Pcs',date:'2026-10-18',reason:'Sample reason',isCancelled:false}]}));show();fireEvent.click(await screen.findByRole('button',{name:'Reverse entry #9'}));await waitFor(()=>expect(http.post).toHaveBeenCalledWith('/stockentries/9/cancel'));});
