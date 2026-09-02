using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Numbers for documents that were IMPORTED rather than issued here.
    ///
    /// A company's invoice sequence belongs to the invoices this system issues:
    /// the operator sets <c>Company.StartingInvoiceNumber</c>, and every bill
    /// they raise follows on from it. Migrated history was numbered by whatever
    /// the business used before, and those references are not ours to spend.
    ///
    /// Before this existed, a customer-ledger import wrote the workbook's own
    /// reference numbers straight into <c>InvoiceNumber</c>: 596 invoices
    /// numbered 1-599 on a company whose configured start was 51. The operator
    /// could then never reach 51 (it was taken), the allocator's MAX+1 landed
    /// at 950003, and re-importing the same workbook was refused for colliding
    /// with the documents its own previous run had created.
    ///
    /// So imported documents live in a reserved band ABOVE anything an
    /// operator would configure, and the sequence allocator ignores them
    /// (<c>!IsMigrated</c>). The document's real identity — "AA-51" — is kept
    /// on <see cref="Models.Invoice.ExternalRef"/> and shown in place of the
    /// number, which is what the operator actually recognises.
    /// </summary>
    public static class MigratedDocumentNumbers
    {
        /// <summary>
        /// First number in the reserved band. Deliberately far above any
        /// plausible operator sequence, and matching the band the ledger
        /// importer already used for opening balances so existing rows sit in
        /// the same space.
        /// </summary>
        public const int Floor = 900_001;

        /// <summary>True when a number belongs to the imported band.</summary>
        public static bool IsReserved(int number) => number >= Floor;

        /// <summary>
        /// Next free number in the band for this company. Callers allocating a
        /// run of documents take this once and increment, then save — the band
        /// is only ever written by an import, which holds a transaction.
        /// </summary>
        public static async Task<int> NextAsync(AppDbContext db, int companyId, CancellationToken ct = default)
        {
            var highest = await db.Invoices
                .Where(i => i.CompanyId == companyId && i.InvoiceNumber >= Floor)
                .MaxAsync(i => (int?)i.InvoiceNumber, ct);

            return (highest ?? Floor - 1) + 1;
        }
    }
}
