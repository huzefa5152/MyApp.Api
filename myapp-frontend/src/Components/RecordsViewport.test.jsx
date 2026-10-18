// @vitest-environment jsdom
import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import RecordsViewport from './RecordsViewport';
import ListFilters from './ListFilters';
afterEach(()=>{cleanup();window.innerWidth=1024;});
it('retains record actions and keeps filters outside the scrolling region',()=>{
 const action=vi.fn(),filter=vi.fn();
 render(<><label>Search<input onChange={filter}/></label><RecordsViewport label="Sample records"><button onClick={action}>Open record</button></RecordsViewport></>);
 const region=screen.getByRole('region',{name:'Sample records'});
 expect(region.tabIndex).toBe(0);expect(region.contains(screen.getByLabelText('Search'))).toBe(false);
 fireEvent.change(screen.getByLabelText('Search'),{target:{value:'sample'}});fireEvent.click(screen.getByRole('button',{name:'Open record'}));
 expect(filter).toHaveBeenCalledTimes(1);expect(action).toHaveBeenCalledTimes(1);
});
it('does not introduce a page viewport in standalone template dialogs',()=>{
 render(<RecordsViewport enabled={false}><button>Choose design</button></RecordsViewport>);
 expect(screen.queryByRole('region')).toBeNull();expect(screen.getByRole('button',{name:'Choose design'})).toBeTruthy();
});
it('allows phone filters to expand and collapse without losing entered values',()=>{
 window.innerWidth=375;
 const view=render(<ListFilters><label>Find<input defaultValue="Saved filter"/></label></ListFilters>);
 const details=view.container.querySelector('details'),summary=view.container.querySelector('summary');
 expect(details.open).toBe(false);fireEvent.click(summary);expect(details.open).toBe(true);
 fireEvent.change(screen.getByLabelText('Find'),{target:{value:'Updated filter'}});fireEvent.click(summary);fireEvent.click(summary);
 expect(screen.getByLabelText('Find').value).toBe('Updated filter');
});
it('keeps desktop filters expanded',()=>{
 window.innerWidth=1280;const view=render(<ListFilters><input aria-label="Search"/></ListFilters>);
 expect(view.container.querySelector('details').open).toBe(true);
});
