using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using System.Reflection;
var count = 0;
void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); count++; }
var catalog = new ItemType { Id=1, Name="Sample electrical goods", UOM="Pcs", FbrUOMId=7 };
var source = new[] { "Nos", "Ft", "Pcs" }.Select((u,i) => new InvoiceItem { Id=i+1, ItemTypeId=1, ItemTypeName=catalog.Name, ItemType=catalog, UOM=u, Quantity=i+1, UnitPrice=100, LineTotal=(i+1)*100, HSCode="8536", SaleType="Goods" }).ToList();
var apply = typeof(FbrService).GetMethod("ApplyAdjustmentOverlay", BindingFlags.Static|BindingFlags.NonPublic)!;
var tax = source.Select(i => (InvoiceItem)apply.Invoke(null, new object[] { i })!).ToList();
Check(tax.All(i => i.UOM=="Pcs" && i.FbrUOMId==7), "FBR resolves catalog UOM for every commercial unit");
Check(tax.GroupBy(TaxInvoiceGrouping.Key).Count()==1, "FBR groups mixed commercial UOM as one type");
Check(tax.Sum(i => i.LineTotal)==600 && tax.Sum(i=>i.Quantity)==6, "FBR grouping preserves values before consultant adjustment");
Check(source.Select(i=>i.UOM).SequenceEqual(new[]{"Nos","Ft","Pcs"}), "commercial rows remain unchanged");
source[0].Adjustment=new InvoiceItemAdjustment { AdjustedItemTypeId=2, AdjustedItemTypeName="Sample adjusted goods", AdjustedUOM="KG", AdjustedFbrUOMId=8, AdjustedQuantity=5, AdjustedUnitPrice=20, AdjustedLineTotal=100 };
var adjusted=(InvoiceItem)apply.Invoke(null,new object[]{source[0]})!;
Check(adjusted.UOM=="KG" && adjusted.FbrUOMId==8 && adjusted.Quantity==5, "consultant overlay controls FBR UOM and quantity");
Check(!TaxInvoiceGrouping.Key(adjusted).Equals(TaxInvoiceGrouping.Key(tax[1])), "different adjusted item types remain separate");
tax[1].SroScheduleNo="Schedule";
Check(tax.GroupBy(TaxInvoiceGrouping.Key).Count()==2, "different SRO treatment is never silently merged");
Check(TaxInvoiceGrouping.Uom(source[1],false)=="Ft", "filed snapshot bypasses current catalog");
var many = Enumerable.Range(0, 24).Select(i => new InvoiceItem {
    Id = 100+i, ItemTypeId = 1, ItemTypeName = catalog.Name, ItemType = catalog,
    UOM = i % 2 == 0 ? "Ft" : "Nos", Quantity = 2, UnitPrice = 100, LineTotal = 200,
    Adjustment = new InvoiceItemAdjustment {
        AdjustedQuantity = i == 23 ? 0.416m : 0.416m + (i < 16 ? 0.001m : 0m),
        AdjustedLineTotal = 200
    }
}).ToList();
// 24 positive internal shares sum to the consultant's ten whole Pcs.
var manyEffective = many.Select(i => (InvoiceItem)apply.Invoke(null, new object[] { i })!).ToList();
Check(manyEffective.GroupBy(TaxInvoiceGrouping.Key).Count() == 1, "24 allocation shares produce one FBR item");
Check(manyEffective.Sum(i => i.Quantity) == 10m, "FBR grouped quantity is ten whole Pcs");
Check(manyEffective.Sum(i => i.LineTotal) == 4800m, "FBR value survives fractional internal shares");
Check(many.All(i => i.Quantity == 2m), "FBR projection preserves commercial quantities");
Console.WriteLine($"{count}/{count} tax grouping checks passed");
