import {it,expect} from 'vitest';
import {purchaseBillTotals} from './purchaseBillTotals.mjs';
it('rounds fractional lines before subtotal and GST',()=>{
 expect(purchaseBillTotals([{quantity:'0.3333',unitPrice:'0.1'},{quantity:'0.3333',unitPrice:'0.1'}],18)).toEqual({lineTotals:[0.03,0.03],subtotal:0.06,gstAmount:0.01,grandTotal:0.07});
});
it('matches decimal half-to-even for lines and GST',()=>{
 expect(purchaseBillTotals([{quantity:1,unitPrice:'1.005'},{quantity:1,unitPrice:'1.015'}],0).lineTotals).toEqual([1,1.02]);
 expect(purchaseBillTotals([{quantity:1,unitPrice:1}],0.5).gstAmount).toBe(0);
 expect(purchaseBillTotals([{quantity:1,unitPrice:1}],1.5).gstAmount).toBe(0.02);
});
it('keeps zero rates and scientific decimal quantities finite',()=>{
 expect(purchaseBillTotals([{quantity:1e-7,unitPrice:1000000}],0).grandTotal).toBe(0.1);
 expect(purchaseBillTotals([{quantity:'',unitPrice:''}],'').grandTotal).toBe(0);
});
