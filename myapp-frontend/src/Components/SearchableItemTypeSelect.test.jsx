// @vitest-environment jsdom
import React from 'react';
import {it,expect,afterEach,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import SearchableItemTypeSelect from './SearchableItemTypeSelect';
afterEach(cleanup);
const items=[{id:1,name:'Draft item',hsCode:null,availableQty:10},{id:2,name:'Classified item',hsCode:'8412.9020',availableQty:0},{id:3,name:'Blank item',hsCode:'   '}];
it('purchase grouping separates HS and non-HS items and preserves selection',async()=>{
 const change=vi.fn();
 render(<SearchableItemTypeSelect items={items} groupByHsCode onChange={change}/>);
 fireEvent.click(screen.getByRole('button'));
 await screen.findByPlaceholderText('Search by name, HS code…');
 expect(screen.getByText('With HS code · inventory items')).toBeTruthy();
 expect(screen.getByText('Without HS code · no stock movement')).toBeTruthy();
 expect(screen.queryByText('10 in stock')).toBeNull();
 fireEvent.change(screen.getByPlaceholderText('Search by name, HS code…'),{target:{value:'Draft'}});
 expect(screen.queryByText('Classified item')).toBeNull();
 fireEvent.mouseDown(screen.getByText('Draft item'));
 expect(change).toHaveBeenCalledWith(1,items[0]);
});
it('phone dropdown stays within viewport',async()=>{
 Object.defineProperty(window,'innerWidth',{configurable:true,value:375});
 render(<SearchableItemTypeSelect items={items} groupByHsCode onChange={()=>{}}/>);
 fireEvent.click(screen.getByRole('button'));
 const input=await screen.findByPlaceholderText('Search by name, HS code…');
 const popup=input.closest('[data-admin-popup]');
 expect(parseFloat(popup.style.width)).toBeLessThanOrEqual(359);
 expect(parseFloat(popup.style.left)+parseFloat(popup.style.width)).toBeLessThanOrEqual(375);
});
