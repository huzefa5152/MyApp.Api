using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

public static class TaxInvoiceGrouping
{
    public static string Uom(InvoiceItem item, bool useCatalog = true) => item.Adjustment?.AdjustedUOM
        ?? (useCatalog && !string.IsNullOrWhiteSpace(item.ItemType?.UOM) ? item.ItemType.UOM : item.UOM);
    public static int? FbrUomId(InvoiceItem item, bool useCatalog = true) => item.Adjustment?.AdjustedFbrUOMId
        ?? (useCatalog && !string.IsNullOrWhiteSpace(item.ItemType?.UOM) ? item.ItemType.FbrUOMId : item.FbrUOMId);
    public static object Key(InvoiceItem item) => new {
        item.ItemTypeId, item.ItemTypeName, item.HSCode, item.SaleType, item.RateId,
        item.SroScheduleNo, item.SroItemSerialNo,
        Singleton = !item.ItemTypeId.HasValue || string.IsNullOrWhiteSpace(item.ItemTypeName) ? item.Id : 0
    };
}
