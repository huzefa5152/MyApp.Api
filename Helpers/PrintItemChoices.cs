using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers;

public record PrintItemSource(decimal BillQuantity, decimal InvoiceQuantity,
    string? BillType, string? InvoiceType, string? BillUom, string? InvoiceUom,
    decimal InvoiceValue);

/// <summary>Display-only choices from the exact source lines of one print group.</summary>
public static class PrintItemChoices
{
    public static PrintTaxItemDto Apply(PrintTaxItemDto row, IEnumerable<PrintItemSource> source, decimal gstRate)
    {
        var lines = source.ToList();
        static string Names(IEnumerable<string?> values) => string.Join(", ",
            values.Where(v => !string.IsNullOrWhiteSpace(v)).Distinct());
        row.BillQuantity = lines.Sum(x => x.BillQuantity);
        row.InvoiceQuantity = lines.Sum(x => x.InvoiceQuantity);
        row.BillItemTypeName = Names(lines.Select(x => x.BillType));
        row.InvoiceItemTypeName = Names(lines.Select(x => x.InvoiceType));
        row.BillUom = Names(lines.Select(x => x.BillUom));
        row.InvoiceUom = Names(lines.Select(x => x.InvoiceUom));
        row.InvoiceValueExclTax = lines.Sum(x => x.InvoiceValue);
        row.InvoiceUnitPrice = row.InvoiceQuantity != 0
            ? Math.Round(row.InvoiceValueExclTax / row.InvoiceQuantity, 2) : 0m;
        row.InvoiceGstAmount = Math.Round(row.InvoiceValueExclTax * gstRate / 100m, 2);
        row.InvoiceTotalInclTax = row.InvoiceValueExclTax + row.InvoiceGstAmount;
        return row;
    }
}
