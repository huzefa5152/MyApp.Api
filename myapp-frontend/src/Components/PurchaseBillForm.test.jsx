// @vitest-environment jsdom
import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import PurchaseBillForm from './PurchaseBillForm';
import {getPurchaseBillById,createPurchaseBill,updatePurchaseBill,previewPurchaseStock} from '../api/purchaseBillApi';
vi.mock('../api/purchaseBillApi',()=>({getPurchaseBillById:vi.fn(),createPurchaseBill:vi.fn(),updatePurchaseBill:vi.fn(),previewPurchaseStock:vi.fn(async()=>({data:{trackingEnabled:true,items:[]}}))}));
vi.mock('../api/supplierApi',()=>({getSuppliersByCompany:()=>Promise.resolve({data:[{id:7,name:'Sample supplier'},{id:8,name:'Second supplier',ntn:'1234567'}]})}));
vi.mock('../api/itemTypeApi',()=>({getItemTypes:()=>Promise.resolve({data:[{id:4,name:'Sample catalog item',hsCode:'8414.5910'}]})}));
vi.mock('../api/unitsApi',()=>({getAllUnits:()=>Promise.resolve({data:[]})}));
vi.mock('./AttachmentManager',()=>({default:React.forwardRef(()=> <div>Attachments preview</div>)}));
vi.mock('./BillNumberField',()=>({default:()=> <div>Purchase number</div>,billNumberPayload:()=>null}));
vi.mock('./DocumentCopyPicker',()=>({default:()=> <button type="button">Copy document</button>}));
vi.mock('./SearchableItemTypeSelect',()=>({default:({onChange})=> <button type="button" onClick={()=>onChange(5,{name:'Sample non-stock item',hsCode:null,uom:'Pcs'})}>Choose item type</button>}));
vi.mock('../utils/notify',()=>({notify:vi.fn()}));
const bill={id:19,purchaseBillNumber:19,supplierId:7,date:'2026-08-08',gstRate:18,withholdingTaxRate:null,withholdingTaxAmount:0,items:[{id:11,itemTypeId:4,itemTypeName:'Sample catalog item',description:'Sample valve',quantity:2,unitPrice:100,uom:'Pcs',hsCode:'8414.5910',sourceInvoiceItemIds:[55]}]};
beforeEach(()=>{vi.clearAllMocks();previewPurchaseStock.mockResolvedValue({data:{trackingEnabled:true,items:[]}});Object.defineProperty(window,'innerWidth',{configurable:true,value:1280});getPurchaseBillById.mockResolvedValue({data:bill});createPurchaseBill.mockResolvedValue({data:{id:20}});updatePurchaseBill.mockResolvedValue({data:{id:19}});});
afterEach(cleanup);
it('requires a category before revealing or submitting bill details',async()=>{
 const {container}=render(<PurchaseBillForm companyId={1} onClose={()=>{}}/>);
 expect(screen.queryByLabelText('Description for item 1')).toBeNull();
 fireEvent.submit(container.querySelector('form'));
 await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toContain('Choose a purchase category');
 expect(createPurchaseBill).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('radio',{name:/Local direct purchase/}));
 fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 await screen.findByLabelText('Description for item 1');
 expect(screen.getByLabelText('GST rate').value).toBe('0');
 expect(screen.queryByRole('button',{name:'Choose item type'})).toBeNull();
});
it('creates a local direct purchase after category selection without inventory fields',async()=>{
 render(<PurchaseBillForm companyId={1} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('radio',{name:/Local direct purchase/}));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 fireEvent.click(await screen.findByRole('button',{name:/Search supplier/}));fireEvent.mouseDown(await screen.findByText('Sample supplier'));
 fireEvent.change(screen.getByLabelText('Description for item 1'),{target:{value:'Sample direct cost'}});
 fireEvent.change(screen.getByLabelText('Unit price for item 1'),{target:{value:'25'}});
 fireEvent.click(screen.getByRole('button',{name:'Create',exact:true}));
 await waitFor(()=>expect(createPurchaseBill).toHaveBeenCalled());
 expect(createPurchaseBill.mock.calls[0][0]).toEqual(expect.objectContaining({purchaseCategory:'LocalDirect',gstRate:0,items:[expect.objectContaining({description:'Sample direct cost',unitPrice:25,itemTypeId:null,hsCode:null})]}));
 expect(previewPurchaseStock).not.toHaveBeenCalled();
});
it('keeps entered prices and descriptions when changing category and clears catalog binding',async()=>{
 render(<PurchaseBillForm companyId={1} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('radio',{name:/Inventory purchase/}));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 fireEvent.change(await screen.findByLabelText('Description for item 1'),{target:{value:'Sample preserved line'}});
 fireEvent.change(screen.getByLabelText('Unit price for item 1'),{target:{value:'35'}});
 fireEvent.click(screen.getByRole('button',{name:'Choose item type'}));
 fireEvent.click(screen.getByRole('button',{name:'Change category'}));
 fireEvent.click(screen.getByRole('radio',{name:/Local direct purchase/}));
 expect(screen.getByRole('status').textContent).toContain('clears item classifications');
 fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 expect(screen.getByLabelText('Description for item 1').value).toBe('Sample preserved line');
 expect(screen.getByLabelText('Unit price for item 1').value).toBe('35');
 expect(screen.queryByRole('button',{name:'Choose item type'})).toBeNull();
});
it('refuses a blank date before saving',async()=>{
 const {container}=render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByDisplayValue('Sample valve');
 fireEvent.change(screen.getByLabelText('Bill date'),{target:{value:''}});
 fireEvent.submit(container.querySelector('form'));
 await screen.findByText('Choose a valid bill date.');expect(updatePurchaseBill).not.toHaveBeenCalled();
});
it.each([375,768,1280])('view at %ipx hides all line/document/tax mutation controls',async width=>{
 Object.defineProperty(window,'innerWidth',{configurable:true,value:width});
 const {container}=render(<PurchaseBillForm companyId={1} billId={19} readOnly onClose={()=>{}}/>);
 await screen.findByDisplayValue('Sample valve');
 for(const name of ['Add line','Copy line','Copy document','Choose item type','Withholding tax','Update','Create'])expect(screen.queryByRole('button',{name,exact:true})).toBeNull();
 expect(screen.getByText('Sample catalog item')).toBeTruthy();
 expect(screen.getByText('Rs. 236.00')).toBeTruthy();
 fireEvent.submit(container.querySelector('form'));
 expect(createPurchaseBill).not.toHaveBeenCalled();expect(updatePurchaseBill).not.toHaveBeenCalled();
 expect(container.querySelector('fieldset').disabled).toBe(true);
});
it('edit can copy a line without reusing its id or sale links and save correctly',async()=>{
 render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByDisplayValue('Sample valve');
 fireEvent.click(screen.getByRole('button',{name:'Copy line'}));
 expect(screen.getAllByDisplayValue('Sample valve')).toHaveLength(2);
 expect(screen.getByText('Rs. 472.00')).toBeTruthy();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'Update',exact:true}));
 await waitFor(()=>expect(updatePurchaseBill).toHaveBeenCalled());
 const payload=updatePurchaseBill.mock.calls[0][1];
 expect(payload.companyId).toBe(1);expect(payload.supplierId).toBe(7);expect(payload.gstRate).toBe(18);
 expect(payload.items[0].id).toBe(11);expect(payload.items[0].sourceInvoiceItemIds).toEqual([55]);
 expect(payload.items[1].id).toBe(0);expect(payload.items[1].sourceInvoiceItemIds).toEqual([]);
});
it('create exposes line actions and requires a supplier before writing',async()=>{
 const {container}=render(<PurchaseBillForm companyId={1} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('radio',{name:/Inventory purchase/}));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:/Search supplier/})).toBeTruthy());
 expect(screen.getByRole('button',{name:'Add line'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Copy line'})).toBeTruthy();
 fireEvent.submit(container.querySelector('form'));
 await screen.findByText('Select a supplier.');expect(createPurchaseBill).not.toHaveBeenCalled();
});
it('non-stock supplier purchase edit preserves the non-stock classification',async()=>{
 getPurchaseBillById.mockResolvedValue({data:{...bill,isNonStockSupplierPurchase:true,items:[{...bill.items[0],itemTypeId:null,hsCode:'',sourceInvoiceItemIds:[]}]}});
 render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByText('Non-stock supplier cost');
 expect(screen.queryByRole('button',{name:'Choose item type'})).toBeNull();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'Update',exact:true}));
 await waitFor(()=>expect(updatePurchaseBill).toHaveBeenCalled());
 expect(updatePurchaseBill.mock.calls[0][1].items[0].itemTypeId).toBeNull();
 expect(updatePurchaseBill.mock.calls[0][1].items[0].hsCode).toBeNull();
});
it.each([0,18])('creates a priced purchase with GST %i and correct preview',async rate=>{
 render(<PurchaseBillForm companyId={1} onClose={()=>{}}/>);
 fireEvent.click(screen.getByRole('radio',{name:/Inventory purchase/}));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:/Search supplier/})).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:/Search supplier/})); fireEvent.mouseDown(await screen.findByText('Sample supplier')); 
 fireEvent.change(screen.getByLabelText('Description for item 1'),{target:{value:'Sample purchase'}});
 fireEvent.change(screen.getByLabelText('Unit price for item 1'),{target:{value:'2.50'}});
 fireEvent.change(screen.getByLabelText('GST rate'),{target:{value:String(rate)}});
 expect(screen.getAllByText(rate===0?'Rs. 2.50':'Rs. 2.95').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Create',exact:true}));
 await waitFor(()=>expect(createPurchaseBill).toHaveBeenCalled());
 expect(createPurchaseBill.mock.calls[0][0]).toEqual(expect.objectContaining({companyId:1,supplierId:7,gstRate:rate,items:[expect.objectContaining({description:'Sample purchase',quantity:1,unitPrice:2.5})]}));
});
it('refuses missing prices and invalid GST before calling the API',async()=>{
 const {container}=render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByDisplayValue('Sample valve');
 fireEvent.change(screen.getByLabelText('Unit price for item 1'),{target:{value:''}});
 fireEvent.submit(container.querySelector('form'));
 await screen.findByText('Enter a non-negative unit price on every line.');
 expect(updatePurchaseBill).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Unit price for item 1'),{target:{value:'100'}});
 fireEvent.change(screen.getByLabelText('GST rate'),{target:{value:'101'}});
 fireEvent.submit(container.querySelector('form'));
 await screen.findByText('GST rate must be between 0 and 100.');
 expect(updatePurchaseBill).not.toHaveBeenCalled();
});
it('view shows existing withholding without tax-edit buttons',async()=>{
 getPurchaseBillById.mockResolvedValue({data:{...bill,withholdingTaxRate:5,withholdingTaxAmount:11.8}});
 render(<PurchaseBillForm companyId={1} billId={19} readOnly onClose={()=>{}}/>);
 await screen.findByDisplayValue('Sample valve');
 expect(screen.queryByRole('button',{name:'Remove withholding tax'})).toBeNull();
 expect(screen.getByDisplayValue('5').disabled).toBe(true);
});
it('edit searches suppliers and sends a selected replacement',async()=>{
 render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByDisplayValue('Sample valve');
 fireEvent.click(screen.getByRole('button',{name:'Sample supplier',exact:true}));
 fireEvent.change(screen.getByPlaceholderText('Search…'),{target:{value:'Second'}});
 fireEvent.mouseDown(screen.getByText('Second supplier'));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'Update',exact:true}));
 await waitFor(()=>expect(updatePurchaseBill).toHaveBeenCalled());
 expect(updatePurchaseBill.mock.calls[0][1].supplierId).toBe(8);
});
it('edit explains why a payment-linked supplier is locked',async()=>{
 getPurchaseBillById.mockResolvedValue({data:{...bill,supplierLockedReason:'Supplier cannot change after a payment has been linked.'}});
 render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByText('Supplier cannot change after a payment has been linked.');
 expect(screen.getByRole('button',{name:'Sample supplier',exact:true}).disabled).toBe(true);
});

it('edit shows server inventory quantities and prevents saving a stale preview',async()=>{
 previewPurchaseStock.mockResolvedValue({data:{trackingEnabled:true,items:[{itemTypeId:4,name:'Sample catalog item',hsCode:'8414.5910',uom:'Pcs',tracksStock:true,currentQuantity:8,changeQuantity:0,afterQuantity:8}]}});
 render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByDisplayValue('Sample valve');
 expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(true);
 await screen.findByText('Current stock');
 expect(previewPurchaseStock.mock.calls.at(-1)[0]).toMatchObject({companyId:1,billId:19});
 expect(screen.getByText('After saving')).toBeTruthy();
 let resolve;
 previewPurchaseStock.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 fireEvent.change(screen.getByLabelText('Unit price for item 1'),{target:{value:'110'}});
 // Price-only changes do not alter the quantity preview or block a ready save.
 expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(false);
 const quantity=screen.getByDisplayValue('2');
 fireEvent.change(quantity,{target:{value:'5'}});
 expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(true);
 await waitFor(()=>expect(resolve).toBeTruthy());
 resolve({data:{trackingEnabled:true,items:[{itemTypeId:4,name:'Sample catalog item',hsCode:'8414.5910',uom:'Pcs',tracksStock:true,currentQuantity:8,changeQuantity:3,afterQuantity:11}]}});
 await screen.findByText('+3');
 expect(screen.getByText('11 Pcs')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(false);
});
it('failed inventory preview blocks saving and supports retry',async()=>{
 previewPurchaseStock.mockRejectedValue(new Error('Preview unavailable'));
 render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByRole('button',{name:'Retry inventory preview'});
 expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(true);
 previewPurchaseStock.mockResolvedValue({data:{trackingEnabled:false,items:[]}});
 fireEvent.click(screen.getByRole('button',{name:'Retry inventory preview'}));
 await screen.findByText('Inventory tracking is off for this company. No stock will move.');
 expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(false);
});
it('non-stock challan purchase explains that no inventory will move',async()=>{
 getPurchaseBillById.mockResolvedValue({data:{...bill,isNonStockSupplierPurchase:true,items:[{...bill.items[0],itemTypeId:null,hsCode:null,sourceInvoiceItemIds:[]}]}});
 render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByText('No inventory movement. This purchase records supplier costs only.');
 expect(previewPurchaseStock).not.toHaveBeenCalled();
});

it('switching to a no-HS item clears the previous HS code before saving',async()=>{
 getPurchaseBillById.mockResolvedValue({data:{...bill,items:[{...bill.items[0],sourceInvoiceItemIds:[]}]}});
 render(<PurchaseBillForm companyId={1} billId={19} onClose={()=>{}}/>);
 await screen.findByDisplayValue('Sample valve');
 fireEvent.click(screen.getByRole('button',{name:'Choose item type'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Update',exact:true}).disabled).toBe(false));
 expect(previewPurchaseStock.mock.calls.at(-1)[0].items[0]).toMatchObject({itemTypeId:5,hsCode:null});
 fireEvent.click(screen.getByRole('button',{name:'Update',exact:true}));
 await waitFor(()=>expect(updatePurchaseBill).toHaveBeenCalled());
 expect(updatePurchaseBill.mock.calls[0][1].items[0]).toMatchObject({itemTypeId:5,hsCode:null});
});
