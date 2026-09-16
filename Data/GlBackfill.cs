using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Data
{
    /// <summary>
    /// One-shot back-post for companies that predate the accounting module.
    ///
    /// Posting is on for every company created from now on, set at creation and
    /// never turned off. A company that existed BEFORE the ledger did has a
    /// history of documents and no entries for them, so its books would start
    /// mid-story — this brings them up to date once, and then that company
    /// behaves like any other.
    ///
    /// Guarded by an <c>AuditLog</c> marker rather than by "has it got entries
    /// yet", the same way every other one-time backfill in this codebase is:
    /// the state it produces is indistinguishable from the state a normal
    /// company reaches on its own, so only an explicit marker can say whether
    /// it has run. A second boot finds the marker and does nothing.
    ///
    /// SAFETY, in the order it matters:
    ///   • It cannot DOUBLE-POST. Posting is replace-on-edit — a document owns
    ///     at most one entry, enforced by a filtered unique index — so even
    ///     running it twice on the same company converges rather than doubles.
    ///   • It cannot leave the books UNBALANCED: every entry goes through the
    ///     ledger's own writer, which refuses anything that does not balance.
    ///   • It is safe on a company that ALREADY has entries, because a rebuild
    ///     removes the system-posted ones first and leaves manual journals
    ///     alone — those are somebody's own work and nothing here can reproduce
    ///     them.
    ///   • One company failing does not stop the others, and does not stop the
    ///     application starting. A company that fails is logged and simply
    ///     stays un-posted, which is the state it was already in.
    /// </summary>
    public static class GlBackfill
    {
        public const string Marker = "GL_BACKFILL_V1";

        public static async Task RunAsync(
            AppDbContext db, ICoaPresetSeeder seeder, IPostingService posting, ILogger logger)
        {
            if (await db.AuditLogs.AnyAsync(a => a.ExceptionType == Marker)) return;

            var companies = await db.Companies
                .Select(c => new { c.Id, c.Name, c.GlPostingEnabled })
                .ToListAsync();
            if (companies.Count == 0)
            {
                // Nothing to do, but still mark it: a fresh install has no
                // history to post, and leaving the marker off would make every
                // later boot re-scan for one.
                await MarkAsync(db, "No companies to back-post.");
                return;
            }

            var posted = 0;
            var failed = 0;
            var details = new List<string>();

            foreach (var c in companies.Where(c => !c.GlPostingEnabled))
            {
                try
                {
                    // A chart first — nothing can post without accounts to post
                    // to. Idempotent, so a company that already has one keeps it
                    // exactly as the operator arranged it.
                    if (!await db.Accounts.AnyAsync(a => a.CompanyId == c.Id))
                        await seeder.SeedWholesaleAsync(c.Id);
                    await posting.EnsureDefaultAccountsAsync(c.Id);

                    // Enable BEFORE posting: every Post* method is a no-op while
                    // the company's ledger is not live, so a rebuild with the
                    // flag still off would quietly do nothing at all.
                    var company = await db.Companies.FirstAsync(x => x.Id == c.Id);
                    company.GlPostingEnabled = true;
                    await db.SaveChangesAsync();

                    var result = await posting.RebuildAsync(c.Id);
                    posted++;
                    details.Add(
                        $"{c.Name}: {result.PostedInvoices} invoices, " +
                        $"{result.PostedPurchaseBills} purchase bills, {result.PostedPayments} payments");
                    logger.LogInformation(
                        "GL backfill: posted company {CompanyId} — {Invoices} invoices, {Bills} bills, {Payments} payments.",
                        c.Id, result.PostedInvoices, result.PostedPurchaseBills, result.PostedPayments);
                }
                catch (Exception ex)
                {
                    failed++;
                    // One company's data problem must not stop the others, and
                    // must not stop the app booting. It stays un-posted — which
                    // is exactly where it already was.
                    logger.LogError(ex, "GL backfill: company {CompanyId} could not be back-posted.", c.Id);
                }
            }

            if (failed > 0)
            {
                // No marker. Leaving it off means the next boot tries again —
                // and because posting is replace-on-edit, retrying the ones that
                // already succeeded costs time and changes nothing.
                logger.LogWarning(
                    "GL backfill: {Failed} of {Total} companies failed; not marking complete so the next start retries.",
                    failed, failed + posted);
                return;
            }

            await MarkAsync(db, posted == 0
                ? "Every company already had its ledger live; nothing to back-post."
                : $"Back-posted {posted} companies. {string.Join("; ", details)}");
        }

        private static async Task MarkAsync(AppDbContext db, string message)
        {
            db.AuditLogs.Add(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Info",
                UserName = "system",
                HttpMethod = "SEED",
                RequestPath = "/migrations/gl-backfill",
                StatusCode = 200,
                ExceptionType = Marker,
                Message = message,
            });
            await db.SaveChangesAsync();
        }
    }
}
