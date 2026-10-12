using System.Security.Cryptography;
using System.Globalization;
using System.Text.Json;
using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

public static class TaxFilingProjection
{
    private static string Hash(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static string? Number(decimal? value) => value?.ToString("G29", CultureInfo.InvariantCulture);

    // Deliberately excludes workflow flags and filing data: a review cannot invalidate itself.
    public static string SourceVersion(Invoice bill) => Hash(new {
        bill.CompanyId, bill.ClientId, bill.InvoiceNumber, Date = bill.Date.ToString("yyyy-MM-ddTHH:mm:ss.fffffff", CultureInfo.InvariantCulture),
        Subtotal = Number(bill.Subtotal), GSTRate = Number(bill.GSTRate), GSTAmount = Number(bill.GSTAmount),
        FurtherTaxRate = Number(bill.FurtherTaxRate), FurtherTaxAmount = Number(bill.FurtherTaxAmount),
        bill.DocumentType, bill.PaymentTerms,
        Lines = bill.Items.OrderBy(i => i.Id).Select(i => new {
            i.Id, i.DeliveryItemId, i.Description, i.ItemTypeId, i.ItemTypeName,
            Quantity = Number(i.Quantity), i.UOM, UnitPrice = Number(i.UnitPrice), LineTotal = Number(i.LineTotal), i.HSCode, i.SaleType,
            i.RateId, i.SroScheduleNo, i.SroItemSerialNo, Retail = Number(i.FixedNotifiedValueOrRetailPrice)
        })
    });
    public static bool HasConsultantWork(Invoice bill) => bill.FbrReviewedAt != null
        || bill.TaxFilingRowsJson != null || bill.Items.Any(i => i.Adjustment != null);

    public static bool NeedsInitialAdjustment(Invoice bill) => !bill.IsDemo && bill.NoteKind == 0
        && !bill.IsCancelled && bill.FbrStatus != FbrSubmissionStatus.Submitted && !HasConsultantWork(bill);

    public static bool NeedsReReview(Invoice bill) => HasConsultantWork(bill)
        && (bill.FbrReviewRequiredAt != null || IsStale(bill));

    public static void PreserveLegacyFiling(Invoice bill)
    {
        var overlays = bill.Items.Where(i => i.Adjustment != null).Select(i => i.Adjustment!).ToList();
        if (bill.TaxFilingRowsJson != null || overlays.Count == 0) return;
        bill.TaxFilingRowsJson = JsonSerializer.Serialize(new TaxFilingPlan {
            SourceVersion = SourceVersion(bill), Rows = InitialRows(bill),
            SavedAt = overlays.Max(a => a.UpdatedAt ?? a.CreatedAt), SavedBy = overlays[0].CreatedByUserId ?? 0
        });
    }

    public static void RecordCommercialChange(Invoice bill, string previousSource, bool hadConsultantWork)
    {
        if (!hadConsultantWork) bill.FbrReviewRequiredAt = null;
        else if (previousSource != SourceVersion(bill)) bill.FbrReviewRequiredAt = DateTime.UtcNow;
    }

    public static string EditVersion(Invoice bill) => Hash(new { Source = SourceVersion(bill), bill.TaxFilingRowsJson });
    public static TaxFilingPlan? Plan(Invoice bill) => bill.TaxFilingRowsJson == null ? null
        : JsonSerializer.Deserialize<TaxFilingPlan>(bill.TaxFilingRowsJson)
          ?? throw new InvalidOperationException("The saved tax filing is unreadable. Review the invoice again.");
    public static bool IsStale(Invoice bill) => Plan(bill) is { } p && p.SourceVersion != SourceVersion(bill);

    public static InvoiceItem LegacyLine(InvoiceItem i) => new() {
        Id = i.Id, InvoiceId = i.InvoiceId, ItemTypeId = i.Adjustment?.AdjustedItemTypeId ?? i.ItemTypeId,
        ItemTypeName = i.Adjustment?.AdjustedItemTypeName ?? i.ItemTypeName,
        Description = i.Description, Quantity = i.Adjustment?.AdjustedQuantity ?? i.Quantity,
        UnitPrice = i.Adjustment?.AdjustedUnitPrice ?? i.UnitPrice,
        LineTotal = i.Adjustment?.AdjustedLineTotal ?? i.LineTotal,
        HSCode = i.Adjustment?.AdjustedHSCode ?? i.HSCode,
        SaleType = i.Adjustment?.AdjustedSaleType ?? i.SaleType,
        UOM = TaxInvoiceGrouping.Uom(i), FbrUOMId = TaxInvoiceGrouping.FbrUomId(i),
        RateId = i.RateId, SroScheduleNo = i.SroScheduleNo, SroItemSerialNo = i.SroItemSerialNo,
        FixedNotifiedValueOrRetailPrice = i.FixedNotifiedValueOrRetailPrice
    };

    public static List<TaxFilingRowDto> InitialRows(Invoice bill, bool commercial = false) => bill.Items.Select(i => commercial ? i : LegacyLine(i))
        .GroupBy(i => new { Classification = TaxInvoiceGrouping.Key(i), i.UOM }).Select(g => new TaxFilingRowDto {
            SourceLineIds = g.Select(i => i.Id).ToList(), ItemTypeId = g.First().ItemTypeId,
            Description = g.First().ItemTypeName ?? g.First().Description,
            HSCode = g.First().HSCode, UOM = g.First().UOM, FbrUOMId = g.First().FbrUOMId,
            SaleType = g.First().SaleType, RateId = g.First().RateId,
            SroScheduleNo = g.First().SroScheduleNo, SroItemSerialNo = g.First().SroItemSerialNo,
            Quantity = g.Sum(i => i.Quantity), ValueExclTax = g.Sum(i => i.LineTotal),
            RetailPrice = g.Sum(i => i.FixedNotifiedValueOrRetailPrice ?? 0m)
        }).ToList();

    public static List<InvoiceItem> Lines(Invoice bill) => Plan(bill) is { } p
        ? p.Rows.Select((r, n) => new InvoiceItem {
            Id = -(n + 1), InvoiceId = bill.Id, ItemTypeId = r.ItemTypeId,
            ItemTypeName = r.Description, Description = r.Description,
            HSCode = r.HSCode, UOM = r.UOM, FbrUOMId = r.FbrUOMId, SaleType = r.SaleType,
            Quantity = r.Quantity, LineTotal = r.ValueExclTax,
            UnitPrice = r.Quantity > 0 ? r.ValueExclTax / r.Quantity : 0,
            RateId = r.RateId, SroScheduleNo = r.SroScheduleNo, SroItemSerialNo = r.SroItemSerialNo,
            FixedNotifiedValueOrRetailPrice = r.RetailPrice
        }).ToList() : bill.Items.Select(LegacyLine).ToList();

    public static void ValidateCoverage(Invoice bill, List<TaxFilingRowDto> rows)
    {
        if (rows == null || rows.Count == 0 || rows.Count > 500 || rows.Any(r => r == null))
            throw new InvalidOperationException("Use between 1 and 500 filing rows.");
        var ids = rows.SelectMany(r => r.SourceLineIds ?? new()).ToList();
        if (rows.Any(r => r.SourceLineIds == null || r.SourceLineIds.Count == 0)
            || ids.Count != ids.Distinct().Count() || !ids.Order().SequenceEqual(bill.Items.Select(i => i.Id).Order()))
            throw new InvalidOperationException("Every original bill line must belong to exactly one filing row. Reload the bill and check the source lines.");
        if (rows.Any(r => r.Quantity <= 0 || r.Quantity > 99999999999999m || decimal.Round(r.Quantity, 4) != r.Quantity
            || r.ValueExclTax <= 0 || r.ValueExclTax > 9999999999999999m || decimal.Round(r.ValueExclTax, 2) != r.ValueExclTax))
            throw new InvalidOperationException("Each row needs a positive quantity (up to 4 decimals) and amount (up to 2 decimals).");
        if (rows.Sum(r => r.ValueExclTax) != bill.Subtotal)
            throw new InvalidOperationException("Filing amounts must equal the bill subtotal exactly. Adjust the amounts before saving.");
        foreach (var row in rows) {
            var sources = bill.Items.Where(i => row.SourceLineIds.Contains(i.Id)).Select(LegacyLine).ToList();
            if (sources.Select(i => new { i.RateId, i.SroScheduleNo, i.SroItemSerialNo, Retail = (i.FixedNotifiedValueOrRetailPrice ?? 0) > 0 }).Distinct().Count() > 1
                || sources.Select(i => i.SaleType?.Trim().ToUpperInvariant()).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().Count() > 1)
                throw new InvalidOperationException("These source lines have different rate, SRO or retail treatments. Keep them in separate filing rows.");
        }
    }
}
