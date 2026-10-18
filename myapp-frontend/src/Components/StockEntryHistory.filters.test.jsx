// @vitest-environment jsdom
import React from 'react';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import StockEntryHistory from './StockEntryHistory';
import http from '../api/httpClient';
vi.mock('../contexts/PermissionsContext',()=>({usePermissions:()=>({has:()=>true})}));
vi.mock('./ConfirmDialog',()=>({useConfirm:()=>async()=>true}));
vi.mock('../api/httpClient',()=>({default:{get:vi.fn(),post:vi.fn()}}));
vi.mock('./StockEntryForm',()=>({default:()=>null}));
const row={id:8,itemName:'Sample stock',kind:'Opening',date:'2026-10-18',quantityDelta:10,unitCost:20,uom:'Pcs',reason:'Initial count',isCancelled:false};
beforeEach(()=>{vi.clearAllMocks();http.get.mockResolvedValue({data:[row]});});afterEach(cleanup);
it('sends entry type, status and encoded search to the scoped server list',async()=>{render(<StockEntryHistory companyId={7}/>);await screen.findByRole('article');fireEvent.change(screen.getByLabelText('Entry type filter'),{target:{value:'Opening'}});await waitFor(()=>expect(http.get).toHaveBeenLastCalledWith('/stockentries/company/7?page=1&kind=Opening'));fireEvent.change(screen.getByLabelText('Entry status filter'),{target:{value:'reversed'}});fireEvent.change(screen.getByLabelText('Search stock entries'),{target:{value:'bolt & nut'}});await waitFor(()=>expect(http.get).toHaveBeenLastCalledWith('/stockentries/company/7?page=1&kind=Opening&status=reversed&search=bolt+%26+nut'));});
it('resets history to page one when a filter changes',async()=>{http.get.mockResolvedValue({data:Array.from({length:20},(_,i)=>({...row,id:i+1}))});render(<StockEntryHistory companyId={7}/>);await screen.findByRole('article',{name:'Stock entry #20'});fireEvent.click(screen.getByRole('button',{name:'Next entries'}));await waitFor(()=>expect(http.get).toHaveBeenLastCalledWith('/stockentries/company/7?page=2'));fireEvent.change(screen.getByLabelText('Entry type filter'),{target:{value:'Adjustment'}});await waitFor(()=>expect(http.get).toHaveBeenLastCalledWith('/stockentries/company/7?page=1&kind=Adjustment'));});
it('ignores a late result for the previous company',async()=>{let resolve;http.get.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({data:[]});const view=render(<StockEntryHistory companyId={7}/>);view.rerender(<StockEntryHistory companyId={8}/>);await screen.findByText('No stock entries yet.');resolve({data:[row]});await waitFor(()=>expect(http.get).toHaveBeenLastCalledWith('/stockentries/company/8?page=1'));expect(screen.queryByRole('article')).toBeNull();});
it('uses the dashboard opening and adjustment shortcuts without another purchase dialog',async()=>{const open=vi.fn();render(<StockEntryHistory companyId={7} onNewEntry={open}/>);await screen.findByRole('article');fireEvent.click(screen.getByRole('button',{name:'Opening stock',exact:true}));expect(open).toHaveBeenLastCalledWith('Opening');fireEvent.click(screen.getByRole('button',{name:'Adjustment',exact:true}));expect(open).toHaveBeenLastCalledWith('Adjustment');});
