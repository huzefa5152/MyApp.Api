using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

public static class CompanyDocumentNumbers
{
    public sealed class SequenceExhaustedException() : InvalidOperationException("The Auto sequence is exhausted. Choose Custom and enter an unused number.");
    public static string Permission(string kind, bool edit = false) => kind switch
    {
        "quote" => edit ? "salesquotes.manage.update" : "salesquotes.manage.create",
        "order" => edit ? "salesorders.manage.update" : "salesorders.manage.create",
        "challan" => edit ? "challans.manage.update" : "challans.manage.create",
        "invoice" => edit ? "bills.manage.update" : "bills.manage.create",
        "purchase-bill" => edit ? "purchasebills.manage.update" : "purchasebills.manage.create",
        "goods-receipt" => edit ? "goodsreceipts.manage.update" : "goodsreceipts.manage.create",
        "credit-note" or "debit-note" when !edit => "invoices.note.create",
        "credit-note" or "debit-note" => throw new InvalidOperationException("Note numbers cannot be edited."),
        _ => throw new InvalidOperationException("Unknown document type.")
    };

    public static int Maximum(string kind) => kind switch
    {
        "invoice" or "challan" => 899999,
        "quote" or "order" or "purchase-bill" or "goods-receipt" or "credit-note" or "debit-note" => int.MaxValue,
        _ => throw new InvalidOperationException("Unknown document type.")
    };

    private static string Counter(string kind) => kind switch
    {
        "quote" => "SalesQuoteNumber", "order" => "SalesOrderNumber", "challan" => "ChallanNumber",
        "invoice" => "InvoiceNumber", "purchase-bill" => "PurchaseBillNumber", "goods-receipt" => "GoodsReceiptNumber",
        "credit-note" => "CreditNoteNumber", "debit-note" => "DebitNoteNumber",
        _ => throw new InvalidOperationException("Unknown document type.")
    };

    private static (int Start, int Current) Settings(Company company, Division? division, string kind)
    {
        if (division != null) return kind switch
        {
            "quote" => (division.StartingSalesQuoteNumber, division.CurrentSalesQuoteNumber),
            "order" => (division.StartingSalesOrderNumber, division.CurrentSalesOrderNumber),
            "challan" => (division.StartingChallanNumber, division.CurrentChallanNumber),
            "invoice" => (division.StartingInvoiceNumber, division.CurrentInvoiceNumber),
            "purchase-bill" => (division.StartingPurchaseBillNumber, division.CurrentPurchaseBillNumber),
            "goods-receipt" => (division.StartingGoodsReceiptNumber, division.CurrentGoodsReceiptNumber),
            "credit-note" => (division.StartingCreditNoteNumber, division.CurrentCreditNoteNumber),
            "debit-note" => (division.StartingDebitNoteNumber, division.CurrentDebitNoteNumber),
            _ => throw new InvalidOperationException("Unknown document type.")
        };
        return kind switch
        {
            "quote" => (company.StartingSalesQuoteNumber, company.CurrentSalesQuoteNumber),
            "order" => (company.StartingSalesOrderNumber, company.CurrentSalesOrderNumber),
            "challan" => (company.StartingChallanNumber, company.CurrentChallanNumber),
            "invoice" => (company.StartingInvoiceNumber, company.CurrentInvoiceNumber),
            "purchase-bill" => (company.StartingPurchaseBillNumber, company.CurrentPurchaseBillNumber),
            "goods-receipt" => (company.StartingGoodsReceiptNumber, company.CurrentGoodsReceiptNumber),
            "credit-note" => (company.StartingCreditNoteNumber, company.CurrentCreditNoteNumber),
            "debit-note" => (company.StartingDebitNoteNumber, company.CurrentDebitNoteNumber),
            _ => throw new InvalidOperationException("Unknown document type.")
        };
    }

    private static IQueryable<int> Numbers(AppDbContext db, int companyId, string kind, int? divisionId, int? excludeId = null) => kind switch
    {
        "quote" => db.SalesQuotes.Where(d => d.CompanyId == companyId && d.DivisionId == divisionId && (excludeId == null || d.Id != excludeId)).Select(d => d.QuoteNumber),
        "order" => db.SalesOrders.Where(d => d.CompanyId == companyId && d.DivisionId == divisionId && (excludeId == null || d.Id != excludeId)).Select(d => d.SalesOrderNumber),
        "challan" => db.DeliveryChallans.Where(d => d.CompanyId == companyId && d.DivisionId == divisionId && !d.IsDemo && (excludeId == null || d.Id != excludeId)).Select(d => d.ChallanNumber),
        "purchase-bill" => db.PurchaseBills.Where(d => d.CompanyId == companyId && d.DivisionId == divisionId && (excludeId == null || d.Id != excludeId)).Select(d => d.PurchaseBillNumber),
        "goods-receipt" => db.GoodsReceipts.Where(d => d.CompanyId == companyId && d.DivisionId == divisionId && (excludeId == null || d.Id != excludeId)).Select(d => d.GoodsReceiptNumber),
        "invoice" or "credit-note" or "debit-note" => db.Invoices.Where(d => d.CompanyId == companyId && d.DivisionId == divisionId && !d.IsDemo
            && d.NoteKind == (kind == "credit-note" ? 2 : kind == "debit-note" ? 1 : 0)
            && (excludeId == null || d.Id != excludeId)).Select(d => d.InvoiceNumber),
        _ => throw new InvalidOperationException("Unknown document type.")
    };

    public static async Task<int> NextAvailableAsync(IQueryable<int> numbers, int start, int current, int maximum)
    {
        long next = Math.Max((long)current + 1, Math.Max(1, start));
        while (next <= maximum)
        {
            var candidate = (int)next;
            var used = await numbers.Where(n => n >= candidate && n <= maximum).Distinct().OrderBy(n => n).Take(256).ToListAsync();
            foreach (var number in used) { if (number > next) return (int)next; next++; }
            if (used.Count < 256 && next <= maximum) return (int)next;
        }
        throw new SequenceExhaustedException();
    }

    private static async Task<string?> ErrorAsync(AppDbContext db, int companyId, string kind, int number, int? divisionId, int? excludeId = null)
    {
        if (number <= 0 || number > Maximum(kind)) return $"Enter a whole number from 1 to {Maximum(kind)}.";
        return await Numbers(db, companyId, kind, divisionId, excludeId).AnyAsync(n => n == number)
            ? $"Document #{number} already exists in this company and division. Pick another number." : null;
    }

    private static async Task<(Company Company, Division? Division)> ScopeAsync(AppDbContext db, int companyId, int? divisionId, bool locked)
    {
        var companyQuery = locked ? db.Companies.FromSqlInterpolated($"SELECT * FROM Companies WITH (UPDLOCK, ROWLOCK) WHERE Id = {companyId}") : db.Companies;
        var company = await companyQuery.AsNoTracking().SingleOrDefaultAsync(c => c.Id == companyId) ?? throw new KeyNotFoundException("Company not found.");
        Division? division = null;
        if (divisionId.HasValue)
        {
            var divisionQuery = locked ? db.Divisions.FromSqlInterpolated($"SELECT * FROM Divisions WITH (UPDLOCK, ROWLOCK) WHERE Id = {divisionId.Value} AND CompanyId = {companyId}") : db.Divisions;
            division = await divisionQuery.AsNoTracking().SingleOrDefaultAsync(d => d.Id == divisionId.Value && d.CompanyId == companyId)
                ?? throw new InvalidOperationException("Division does not belong to this company.");
        }
        return (company, division);
    }

    public static async Task<int> AllocateAsync(AppDbContext db, int companyId, string kind, int? customNumber = null, int? divisionId = null)
    {
        if (db.Database.CurrentTransaction == null) throw new InvalidOperationException("Number allocation requires a transaction.");
        var scope = await ScopeAsync(db, companyId, divisionId, true);
        var settings = Settings(scope.Company, scope.Division, kind);
        var number = customNumber ?? await NextAvailableAsync(Numbers(db, companyId, kind, divisionId), settings.Start, settings.Current, Maximum(kind));
        var error = await ErrorAsync(db, companyId, kind, number, divisionId);
        if (error != null) throw new InvalidOperationException(error);
        if (customNumber.HasValue) return number;
        var property = "Current" + Counter(kind);
        if (divisionId.HasValue)
            await db.Divisions.Where(d => d.Id == divisionId.Value && d.CompanyId == companyId).ExecuteUpdateAsync(s => s.SetProperty(d => EF.Property<int>(d, property), number));
        else await db.Companies.Where(c => c.Id == companyId).ExecuteUpdateAsync(s => s.SetProperty(c => EF.Property<int>(c, property), number));
        return number;
    }

    private static Task<int> StoredNumberAsync(AppDbContext db, int companyId, string kind, int id) => kind switch
    {
        "quote" => db.SalesQuotes.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.QuoteNumber).SingleAsync(),
        "order" => db.SalesOrders.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.SalesOrderNumber).SingleAsync(),
        "challan" => db.DeliveryChallans.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.ChallanNumber).SingleAsync(),
        "purchase-bill" => db.PurchaseBills.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.PurchaseBillNumber).SingleAsync(),
        "goods-receipt" => db.GoodsReceipts.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.GoodsReceiptNumber).SingleAsync(),
        "invoice" => db.Invoices.Where(d => d.Id == id && d.CompanyId == companyId && d.NoteKind == 0).Select(d => d.InvoiceNumber).SingleAsync(),
        _ => throw new InvalidOperationException("This document type cannot be renumbered.")
    };

    public static Task<int?> StoredDivisionAsync(AppDbContext db, int companyId, string kind, int id) => kind switch
    {
        "quote" => db.SalesQuotes.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.DivisionId).SingleAsync(),
        "order" => db.SalesOrders.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.DivisionId).SingleAsync(),
        "challan" => db.DeliveryChallans.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.DivisionId).SingleAsync(),
        "purchase-bill" => db.PurchaseBills.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.DivisionId).SingleAsync(),
        "goods-receipt" => db.GoodsReceipts.Where(d => d.Id == id && d.CompanyId == companyId).Select(d => d.DivisionId).SingleAsync(),
        "invoice" => db.Invoices.Where(d => d.Id == id && d.CompanyId == companyId && d.NoteKind == 0).Select(d => d.DivisionId).SingleAsync(),
        _ => throw new InvalidOperationException("This document type cannot be renumbered.")
    };

    public static async Task RenumberAsync(AppDbContext db, int companyId, string kind, int id, int currentNumber, int? requested, int? divisionId = null)
    {
        if (db.Database.CurrentTransaction == null) throw new InvalidOperationException("Renumbering requires a transaction.");
        _ = Permission(kind, true);
        await ScopeAsync(db, companyId, divisionId, true);
        if (await StoredNumberAsync(db, companyId, kind, id) != currentNumber)
            throw new InvalidOperationException("The document number changed during this save. Reload the document and retry.");
        var number = requested ?? currentNumber;
        if (number == currentNumber && await StoredDivisionAsync(db, companyId, kind, id) == divisionId) return;
        if (number != currentNumber && kind == "challan" && await db.DeliveryChallans.AnyAsync(d => d.CompanyId == companyId
            && (d.Id == id && (d.IsDemo || d.DuplicatedFromId != null) || d.DuplicatedFromId == id)))
            throw new InvalidOperationException("Demo or duplicated challan numbers cannot be changed.");
        var error = await ErrorAsync(db, companyId, kind, number, divisionId, id);
        if (error != null) throw new InvalidOperationException(error);
    }

    public static Task<bool> ExistsAsync(AppDbContext db, int companyId, string kind, int id, int? divisionId = null) => kind switch
    {
        "quote" => db.SalesQuotes.AnyAsync(d => d.Id == id && d.CompanyId == companyId),
        "order" => db.SalesOrders.AnyAsync(d => d.Id == id && d.CompanyId == companyId),
        "challan" => db.DeliveryChallans.AnyAsync(d => d.Id == id && d.CompanyId == companyId),
        "purchase-bill" => db.PurchaseBills.AnyAsync(d => d.Id == id && d.CompanyId == companyId),
        "goods-receipt" => db.GoodsReceipts.AnyAsync(d => d.Id == id && d.CompanyId == companyId),
        "invoice" or "credit-note" or "debit-note" => db.Invoices.AnyAsync(d => d.Id == id && d.CompanyId == companyId && d.NoteKind == (kind == "credit-note" ? 2 : kind == "debit-note" ? 1 : 0)),
        _ => throw new InvalidOperationException("Unknown document type.")
    };

    public static async Task<int> NextAsync(AppDbContext db, int companyId, string kind, int? divisionId = null)
    {
        var scope = await ScopeAsync(db, companyId, divisionId, false);
        var settings = Settings(scope.Company, scope.Division, kind);
        return await NextAvailableAsync(Numbers(db, companyId, kind, divisionId), settings.Start, settings.Current, Maximum(kind));
    }

    public static async Task<object> PreviewAsync(AppDbContext db, int companyId, string kind, int? check, int? excludeId = null, int? divisionId = null)
    {
        var scope = await ScopeAsync(db, companyId, divisionId, false);
        var settings = Settings(scope.Company, scope.Division, kind);
        var next = 0;
        string? autoError = null;
        try { next = await NextAvailableAsync(Numbers(db, companyId, kind, divisionId), settings.Start, settings.Current, Maximum(kind)); }
        catch (SequenceExhaustedException ex) { autoError = ex.Message; }
        var error = check.HasValue ? await ErrorAsync(db, companyId, kind, check.Value, divisionId, excludeId) : null;
        var prefix = kind == "invoice" ? scope.Company.InvoiceNumberPrefix ?? "" : kind is "credit-note" or "debit-note"
            ? (scope.Company.InvoiceNumberPrefix ?? "") + (kind == "credit-note" ? "CN-" : "DN-") : "";
        return new { nextNumber = next, autoError, maxAllowed = Maximum(kind), startingNumberSet = true, prefix, formattedNext = next > 0 ? prefix + next : "",
            @checked = check, formattedChecked = check.HasValue ? prefix + check.Value : null,
            checkedAvailable = check.HasValue ? error == null : (bool?)null, checkedError = error };
    }
}
