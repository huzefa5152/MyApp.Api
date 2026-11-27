using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Implementations;

public partial class InvoiceService
{
    /// <summary>
    /// Puts a bill that was withdrawn at FBR back to "not filed", so the
    /// consultant can correct it and file it again under the same number.
    ///
    /// This is the mirror of <see cref="MarkFbrCancelledAsync"/>, for the case
    /// where the SALE still stands and only the filing was wrong: the bill
    /// takes its challans back, its stock goes out again and it is posted
    /// again. The withdrawn IRN is dropped from the row (FBR issues a new one
    /// on the next submit) and kept in the audit log.
    ///
    /// Refused when the goods have been billed elsewhere since, or a note
    /// stands against the bill: then it is no longer the same sale.
    /// </summary>
    public async Task<InvoiceDto?> ReopenFbrCancelledAsync(int id, string? actorUserName = null)
    {
        var invoice = await _context.Invoices
            .Include(i => i.Items)
            .Include(i => i.Company)
            .Include(i => i.Client)
            .Include(i => i.DeliveryChallans)
            .FirstOrDefaultAsync(i => i.Id == id);
        if (invoice == null) return null;

        if (invoice.IsCancelled)
            throw new InvalidOperationException("This bill is voided, so it cannot be filed again.");
        if (invoice.FbrCancelledAt == null)
            throw new InvalidOperationException(
                "This bill is not marked cancelled at FBR, so there is nothing to reopen.");
        if (await _context.Invoices.AnyAsync(n => n.OriginalInvoiceId == id && !n.IsCancelled))
            throw new InvalidOperationException(
                "This bill has a credit or debit note against it. Void the note first.");

        // The challan rows this bill's lines sit on now. They were released when
        // the bill was withdrawn, so each must still be off every bill.
        var lineIds = invoice.Items.Where(i => i.DeliveryItemId != null)
            .Select(i => i.DeliveryItemId!.Value).Distinct().ToList();
        var rows = await _context.DeliveryChallans.Include(c => c.Items)
            .Where(c => c.CompanyId == invoice.CompanyId && c.Items.Any(i => lineIds.Contains(i.Id)))
            .ToListAsync();
        if (rows.SelectMany(c => c.Items).Count(i => lineIds.Contains(i.Id)) != lineIds.Count)
            throw new InvalidOperationException(
                "A delivery challan line of this bill no longer exists, so the bill cannot take its challans back.");
        var taken = rows.FirstOrDefault(c => !ChallanBillingRules.IsBillable(c.Status, c.InvoiceId));
        if (taken != null)
            throw new InvalidOperationException(
                $"Challan #{taken.ChallanNumber} has been billed again or cancelled since this bill was withdrawn. "
              + "Free it first, then reopen this bill.");

        var withdrawnIrn = invoice.FbrIRN;
        await using var transaction = await _context.Database.BeginTransactionAsync();
        try
        {
            // A row may now also hold lines this bill never carried (unbilled rows
            // of one challan are merged). Those stay billable on a row of their own.
            var touched = new List<int>();
            foreach (var row in rows)
            {
                var others = row.Items.Where(i => !lineIds.Contains(i.Id)).Select(i => i.Id).ToList();
                if (others.Count > 0) touched.Add(await SplitOffAsync(row, others));
                row.Status = "Invoiced";
                row.InvoiceId = invoice.Id;
                touched.Add(row.Id);
            }

            invoice.FbrCancelledAt = null;
            invoice.FbrCancelledReason = null;
            invoice.FbrCancelledBy = null;
            invoice.FbrStatus = null;
            invoice.FbrIRN = null;
            invoice.FbrInvoiceNumber = null;
            invoice.FbrErrorMessage = null;
            invoice.FbrSubmittedAt = null;
            await _context.SaveChangesAsync();

            await MergeBilledSplitsAsync(invoice.Id);
            await _stock.SyncInvoiceStockMovementsAsync(invoice);
            await _posting.PostInvoiceAsync(invoice);
            await SalesDocumentRules.RefreshOrdersAsync(_context, invoice.CompanyId);
            foreach (var challanId in touched) await _purchases.SyncChallanAsync(challanId);
            await transaction.CommitAsync();
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }

        await _auditLog.LogAsync(new AuditLog
        {
            Level = "Info",
            UserName = actorUserName,
            HttpMethod = "POST",
            RequestPath = $"/invoices/{invoice.Id}/fbr-reopen",
            StatusCode = 200,
            ExceptionType = "Invoice.FbrReopened",
            CompanyId = invoice.CompanyId,
            Message = $"Bill #{invoice.InvoiceNumber} reopened for filing again after its FBR cancellation "
                    + $"(withdrawn IRN {withdrawnIrn})"
                    + (rows.Count > 0 ? $"; challans {string.Join(", ", rows.Select(c => c.ChallanNumber).Distinct())} back on the bill" : ""),
        });

        return await GetByIdAsync(invoice.Id);
    }
}
