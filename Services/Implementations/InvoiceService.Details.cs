using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;

namespace MyApp.Api.Services.Implementations;

public partial class InvoiceService
{
    /// <summary>
    /// Changes only the site, PO number and PO date of a STANDALONE bill: the
    /// fields Edit Bill shows for a bill with no challan, under the same locks
    /// (not cancelled, not filed with FBR, not a note). None of them moves an
    /// amount, stock or the ledger. Null leaves a field as it is; blank clears
    /// it; a PO number is set with its date, and clearing it clears the date.
    /// </summary>
    public async Task<InvoiceDto?> UpdateStandaloneDetailsAsync(int id, string? site, string? poNumber, DateTime? poDate)
    {
        var invoice = await _context.Invoices.Include(i => i.DeliveryChallans).FirstOrDefaultAsync(i => i.Id == id);
        if (invoice == null) return null;
        if (!IsInvoiceEditable(invoice))
            throw new InvalidOperationException(invoice.IsCancelled
                ? "Cannot edit a cancelled bill."
                : "Cannot edit a bill that has been submitted to FBR.");
        if (invoice.DocumentType == 9 || invoice.DocumentType == 10)
            throw new InvalidOperationException("A Debit/Credit Note cannot be edited.");
        if (invoice.DeliveryChallans.Count > 0)
            throw new InvalidOperationException("This bill takes its site and PO from its delivery challans. Change them on the challan.");

        if (site != null) invoice.Site = BillSite.Clean(site);
        if (poNumber != null)
        {
            invoice.PoNumber = string.IsNullOrWhiteSpace(poNumber) ? null : poNumber.Trim();
            invoice.PoDate = invoice.PoNumber == null ? null : poDate?.Date;
        }
        await _context.SaveChangesAsync();
        return await GetByIdAsync(id);
    }
}
