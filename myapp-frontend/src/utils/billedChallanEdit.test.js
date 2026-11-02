import { expect, it } from "vitest";
import { deliveryBillImpact, canEditBilledDelivery } from "./billedChallanEdit";
const snapshot={challan:{items:[{id:1},{id:2}]},bill:{items:[{deliveryItemId:1,lineTotal:200},{deliveryItemId:2,lineTotal:100},{deliveryItemId:9,lineTotal:50}],gstRate:18,furtherTaxRate:2,freightCharges:25,withholdingTaxRate:5}};
it("keeps other challans and recalculates the complete commercial collectible",()=>{
 const r=deliveryBillImpact(snapshot,[{id:1,description:"Item",quantity:3,unit:"Pcs",unitPrice:100},{id:0,description:"New",quantity:2,unit:"Pcs",unitPrice:20}]);
 expect(r).toMatchObject({added:1,removed:1,subtotal:390,gst:70.2,further:7.8,total:493,collectible:469.6,valid:true});
});
it("requires explicit rates but permits a deliberate zero",()=>{
 const i={description:"Free",quantity:1,unit:"Pcs",unitPrice:""};expect(deliveryBillImpact(snapshot,[i]).valid).toBe(false);expect(deliveryBillImpact(snapshot,[{...i,unitPrice:0}]).valid).toBe(true);
 expect(deliveryBillImpact(snapshot,[{...i,unitPrice:Infinity}]).valid).toBe(false);expect(deliveryBillImpact(snapshot,[]).valid).toBe(false);
});
it("requires both permissions, a live unsubmitted bill and no generated purchases",()=>{
 const c={invoiceId:5,isEditable:true};const all=()=>true;
 expect(canEditBilledDelivery(c,all)).toBe(true);
 for(const blocked of [{...c,isEditable:false},{...c,hasAutoPurchaseBills:true},{...c,invoiceId:null}])expect(canEditBilledDelivery(blocked,all)).toBe(false);
 expect(canEditBilledDelivery(c,k=>k==="challans.manage.update")).toBe(false);
});
