// @vitest-environment jsdom
import React from 'react';
import {it, expect, vi, beforeEach, afterEach} from 'vitest';
import {render, screen, fireEvent, waitFor, cleanup} from '@testing-library/react';
import StockEntryHistory from './StockEntryHistory';
import http from '../api/httpClient';

const state = vi.hoisted(() => ({has:() => true, confirm:vi.fn()}));
vi.mock('../contexts/PermissionsContext', () => ({usePermissions:() => ({has:state.has})}));
vi.mock('./ConfirmDialog', () => ({useConfirm:() => state.confirm}));
vi.mock('../api/httpClient', () => ({default:{get:vi.fn(), post:vi.fn()}}));
vi.mock('./StockEntryForm', () => ({default:({onClose}) => <section aria-label="Stock entry form"><button onClick={onClose}>Close form</button></section>}));
const entry = {id:9, itemName:'Sample hardware', kind:'Opening', date:'2026-10-18', quantityDelta:5, unitCost:20, uom:'Pcs', reason:'Initial stock count', isCancelled:false};
beforeEach(() => {
  vi.clearAllMocks(); state.has = () => true; state.confirm.mockResolvedValue(true);
  http.get.mockResolvedValue({data:[entry]}); http.post.mockResolvedValue({data:{}});
});
afterEach(cleanup);

it('loads company-scoped history with quantity, valuation and reason', async () => {
  render(<StockEntryHistory companyId={7}/>);
  const row = await screen.findByRole('article', {name:'Stock entry #9'});
  expect(http.get).toHaveBeenCalledWith('/stockentries/company/7?page=1');
  expect(row.textContent).toContain('+5 Pcs'); expect(row.textContent).toContain('100.00');
  expect(row.textContent).toContain('Initial stock count');
  expect(screen.queryByLabelText('Stock entry reason')).toBeNull();
});
it('confirms reversal and refreshes stock and history', async () => {
  const changed = vi.fn(); render(<StockEntryHistory companyId={7} onChanged={changed}/>);
  fireEvent.click(await screen.findByRole('button', {name:'Reverse entry #9'}));
  await waitFor(() => expect(http.post).toHaveBeenCalledWith('/stockentries/9/cancel'));
  expect(state.confirm.mock.calls[0][0].title).toContain('#9');
  await screen.findByText('Stock entry #9 reversed.'); expect(changed).toHaveBeenCalledOnce();
  expect(http.get).toHaveBeenCalledTimes(2);
});
it('leaves entries unchanged when confirmation is cancelled', async () => {
  state.confirm.mockResolvedValue(false); render(<StockEntryHistory companyId={7}/>);
  fireEvent.click(await screen.findByRole('button', {name:'Reverse entry #9'}));
  await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce()); expect(http.post).not.toHaveBeenCalled();
});
it('shows reversed history without another reversal action', async () => {
  http.get.mockResolvedValue({data:[{...entry, isCancelled:true}]}); render(<StockEntryHistory companyId={7}/>);
  await screen.findByText('Reversed'); expect(screen.queryByRole('button', {name:'Reverse entry #9'})).toBeNull();
});
it('retains history and reports a refused reversal', async () => {
  http.post.mockRejectedValue({response:{data:{error:'Not enough stock to reverse this entry.'}}});
  render(<StockEntryHistory companyId={7}/>); fireEvent.click(await screen.findByRole('button', {name:'Reverse entry #9'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Not enough stock');
  expect(screen.getByRole('article', {name:'Stock entry #9'})).toBeTruthy();
});
it('pages history on the server rather than hiding older entries', async () => {
  http.get.mockResolvedValueOnce({data:Array.from({length:20}, (_, i) => ({...entry, id:i+1}))}).mockResolvedValue({data:[]});
  render(<StockEntryHistory companyId={7}/>); await screen.findByRole('article', {name:'Stock entry #20'});
  fireEvent.click(screen.getByRole('button', {name:'Next entries'})); await screen.findByText('No more stock entries.');
  expect(http.get).toHaveBeenLastCalledWith('/stockentries/company/7?page=2');
  expect(screen.getByRole('button', {name:'Previous entries'}).disabled).toBe(false);
});
it('does not request or render history without stock-entry permissions', () => {
  state.has = () => false; render(<StockEntryHistory companyId={7}/>);
  expect(http.get).not.toHaveBeenCalled(); expect(screen.queryByRole('button', {name:'New stock entry'})).toBeNull();
});
it('shows only permitted entry kinds', async () => {
  state.has = key => key === 'stock.adjust.create';
  http.get.mockResolvedValue({data:[entry, {...entry, id:10, kind:'Adjustment', quantityDelta:-2}]});
  render(<StockEntryHistory companyId={7}/>); await screen.findByRole('article', {name:'Stock entry #10'});
  expect(screen.queryByRole('article', {name:'Stock entry #9'})).toBeNull();
  expect(screen.getByText('-2 Pcs')).toBeTruthy();
});
it('discards the old company and its pending confirmation on a company switch', async () => {
  let accept; state.confirm.mockImplementation(() => new Promise(resolve => {accept = resolve;}));
  const view = render(<StockEntryHistory companyId={7}/>);
  fireEvent.click(await screen.findByRole('button', {name:'Reverse entry #9'}));
  http.get.mockResolvedValue({data:[]}); view.rerender(<StockEntryHistory companyId={8}/>);
  await screen.findByText('No stock entries yet.'); accept(true);
  await waitFor(() => expect(http.get).toHaveBeenLastCalledWith('/stockentries/company/8?page=1'));
  expect(http.post).not.toHaveBeenCalled(); expect(screen.queryByRole('article')).toBeNull();
});
it('opens a stock entry directly and refreshes after closing', async () => {
  const changed = vi.fn(); render(<StockEntryHistory companyId={7} onChanged={changed}/>);
  await screen.findByRole('article'); fireEvent.click(screen.getByRole('button', {name:'New stock entry'}));
  expect(screen.getByRole('region', {name:'Stock entry form'})).toBeTruthy(); fireEvent.click(screen.getByRole('button', {name:'Close form'}));
  await waitFor(() => expect(http.get).toHaveBeenCalledTimes(2)); expect(changed).toHaveBeenCalledOnce();
});
it('allows retry after a failed load', async () => {
  http.get.mockRejectedValueOnce(new Error('offline')); render(<StockEntryHistory companyId={7}/>);
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', {name:'Refresh entries'}));
  await screen.findByRole('article'); expect(screen.queryByRole('alert')).toBeNull();
});
