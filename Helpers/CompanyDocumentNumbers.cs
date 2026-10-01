using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

public static class CompanyDocumentNumbers
{
    public static string Permission(string kind) => kind switch
    {
        "quote" => "salesquotes.manage.create",
        "challan" => "challans.manage.create",
        "purchase-bill" => "purchasebills.manage.create",
        "goods-receipt" => "goodsreceipts.manage.create",
        _ => throw new InvalidOperationException("Unknown document type.")
    };

    private static (int Start, int Current) Settings(Company c, string kind) => kind switch
    {
        "quote" => (c.StartingSalesQuoteNumber, c.CurrentSalesQuoteNumber),
        "challan" => (c.StartingChallanNumber, c.CurrentChallanNumber),
        "purchase-bill" => (c.StartingPurchaseBillNumber, c.CurrentPurchaseBillNumber),
        "goods-receipt" => (c.StartingGoodsReceiptNumber, c.CurrentGoodsReceiptNumber),
        _ => throw new InvalidOperationException("Unknown document type.")
    };

    private static IQueryable<int> Numbers(AppDbContext db, int companyId, string kind) => kind switch
    {
        "quote" => db.SalesQuotes.Where(d => d.CompanyId == companyId).Select(d => d.QuoteNumber),
        "challan" => db.DeliveryChallans.Where(d => d.CompanyId == companyId && !d.IsDemo).Select(d => d.ChallanNumber),
        "purchase-bill" => db.PurchaseBills.Where(d => d.CompanyId == companyId).Select(d => d.PurchaseBillNumber),
        "goods-receipt" => db.GoodsReceipts.Where(d => d.CompanyId == companyId).Select(d => d.GoodsReceiptNumber),
        _ => throw new InvalidOperationException("Unknown document type.")
    };

    public static int Maximum(string kind) => kind == "challan" ? 899999 : int.MaxValue;

    public static async Task<int> NextAvailableAsync(IQueryable<int> numbers, int start, int current, int maximum)
    {
        long next = Math.Max((long)current + 1, Math.Max(1, start));
        while (next <= maximum)
        {
            var candidate = (int)next;
            var used = await numbers.Where(n => n >= candidate && n <= maximum)
                .Distinct().OrderBy(n => n).Take(256).ToListAsync();
            foreach (var number in used)
            {
                if (number > next) return (int)next;
                next++;
            }
            if (used.Count < 256 && next <= maximum) return (int)next;
        }
        throw new InvalidOperationException("The document number sequence is exhausted.");
    }

    private static Task<int> NextAsync(AppDbContext db, Company company, string kind)
    {
        var settings = Settings(company, kind);
        return NextAvailableAsync(Numbers(db, company.Id, kind), settings.Start, settings.Current, Maximum(kind));
    }

    private static async Task<string?> ErrorAsync(AppDbContext db, int companyId, string kind, int number)
    {
        if (number <= 0 || number > Maximum(kind)) return $"Enter a whole number from 1 to {Maximum(kind)}.";
        return await Numbers(db, companyId, kind).AnyAsync(n => n == number)
            ? "That document number already exists for this company." : null;
    }

    // The caller owns the transaction: both the counter and document roll back
    // together. The company lock serializes Auto/Custom across app processes.
    public static async Task<int> AllocateAsync(AppDbContext db, int companyId, string kind, int? customNumber = null)
    {
        if (db.Database.CurrentTransaction == null) throw new InvalidOperationException("Number allocation requires a transaction.");
        var company = await db.Companies.FromSqlInterpolated(
            $"SELECT * FROM Companies WITH (UPDLOCK, ROWLOCK) WHERE Id = {companyId}")
            .AsNoTracking().SingleOrDefaultAsync() ?? throw new KeyNotFoundException("Company not found.");
        var number = customNumber ?? await NextAsync(db, company, kind);
        var error = await ErrorAsync(db, companyId, kind, number);
        if (error != null) throw new InvalidOperationException(error);
        // Custom reserves its number without moving the Auto cursor.
        if (customNumber.HasValue) return number;
        var row = db.Companies.Where(c => c.Id == companyId);
        _ = kind switch
        {
            "quote" => await row.ExecuteUpdateAsync(s => s.SetProperty(c => c.CurrentSalesQuoteNumber, c => c.CurrentSalesQuoteNumber < number ? number : c.CurrentSalesQuoteNumber)),
            "challan" => await row.ExecuteUpdateAsync(s => s.SetProperty(c => c.CurrentChallanNumber, c => c.CurrentChallanNumber < number ? number : c.CurrentChallanNumber)),
            "purchase-bill" => await row.ExecuteUpdateAsync(s => s.SetProperty(c => c.CurrentPurchaseBillNumber, c => c.CurrentPurchaseBillNumber < number ? number : c.CurrentPurchaseBillNumber)),
            "goods-receipt" => await row.ExecuteUpdateAsync(s => s.SetProperty(c => c.CurrentGoodsReceiptNumber, c => c.CurrentGoodsReceiptNumber < number ? number : c.CurrentGoodsReceiptNumber)),
            _ => throw new InvalidOperationException("Unknown document type.")
        };
        return number;
    }

    public static async Task<object> PreviewAsync(AppDbContext db, int companyId, string kind, int? check)
    {
        var company = await db.Companies.AsNoTracking().SingleOrDefaultAsync(c => c.Id == companyId)
            ?? throw new KeyNotFoundException("Company not found.");
        var next = await NextAsync(db, company, kind);
        var error = check.HasValue ? await ErrorAsync(db, companyId, kind, check.Value) : null;
        return new { nextNumber = next, maxAllowed = Maximum(kind), startingNumberSet = true,
            checkedAvailable = check.HasValue ? error == null : (bool?)null, checkedError = error };
    }
}
