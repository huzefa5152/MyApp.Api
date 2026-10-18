using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
namespace MyApp.Api.Services.Implementations;

public partial class PostingService
{
    public async Task PostStockEntryAsync(StockEntry entry)
    {
        if (!await IsEnabledAsync(entry.CompanyId)) return;
        if (entry.IsCancelled)
        {
            await RemoveForSourceAsync(entry.CompanyId, SourceDocType.StockEntry, entry.Id);
            return;
        }
        var accounts = await LoadAccountsAsync(entry.CompanyId);
        var inventory = accounts.FirstOrDefault(a => a.ControlType == ControlType.Inventory)
            ?? throw new InvalidOperationException("Configure the inventory control account before recording stock entries.");
        var opening = entry.Kind == "Opening";
        var key = opening ? "stock-entry:opening-equity" : "stock-entry:adjustment";
        var offset = accounts.FirstOrDefault(a => a.ExternalRef == key);
        if (offset == null)
        {
            var groupKey = opening ? "stock-entry:equity-group" : "stock-entry:expense-group";
            var group = await _context.AccountGroups.FirstOrDefaultAsync(g => g.CompanyId == entry.CompanyId && g.ExternalRef == groupKey);
            if (group == null)
            {
                group = new AccountGroup { CompanyId = entry.CompanyId, Name = opening ? "Opening stock equity" : "Inventory adjustments",
                    Statement = opening ? FinancialStatement.BalanceSheet : FinancialStatement.ProfitAndLoss,
                    ExternalRef = groupKey, IsSystem = true };
                _context.AccountGroups.Add(group);
            }
            offset = new Account { CompanyId = entry.CompanyId, Name = opening ? "Opening stock equity" : "Inventory adjustments",
                AccountGroup = group, AccountType = opening ? AccountType.Equity : AccountType.Expense,
                ExternalRef = key, IsActive = true, IsControlAccount = true };
            _context.Accounts.Add(offset);
            await _context.SaveChangesAsync();
        }
        var amount = Math.Round(Math.Abs(entry.QuantityDelta) * entry.UnitCost, 2, MidpointRounding.AwayFromZero);
        var incoming = entry.QuantityDelta > 0;
        var lines = new List<JournalLine>();
        AddLine(lines, inventory.Id, incoming ? amount : 0, incoming ? 0 : amount, entry.Reason);
        AddLine(lines, offset.Id, incoming ? 0 : amount, incoming ? amount : 0, entry.Reason);
        await WriteAsync(entry.CompanyId, SourceDocType.StockEntry, entry.Id, entry.Date, $"Stock entry #{entry.Id}: {entry.Reason}", lines);
    }
}
