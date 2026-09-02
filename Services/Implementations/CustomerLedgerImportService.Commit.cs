using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Writing the reviewed ledger. One transaction: a half-imported ledger is
    /// worse than none, because nobody can tell which customers landed without
    /// checking every one.
    /// </summary>
    public partial class CustomerLedgerImportService
    {
        public async Task<CustomerLedgerCommitResultDto> CommitAsync(
            CustomerLedgerCommitDto dto, int userId)
        {
            var result = new CustomerLedgerCommitResultDto();

            var blocking = await _imports.FindBlockingRunAsync(
                dto.CompanyId, ImportKinds.CustomerLedger, dto.FileSha256);
            if (blocking != null)
                throw new InvalidOperationException(
                    $"This exact file was already imported on {blocking.ImportedAt:d MMM yyyy}. Nothing was changed.");

            if (dto.Clients.Count == 0)
                throw new InvalidOperationException("There is nothing to import.");

            // Re-check the reconciliation on the SERVER. The preview computed it,
            // but the commit body is client-supplied and an out-of-balance ledger
            // is exactly what must never be written.
            // BalanceTolerance, not the rounding-aware one: this checks the
            // body's OWN arithmetic is self-consistent, where no rounding has
            // intervened. Agreement with the source sheet was settled at preview.
            var broken = dto.Clients
                .Where(c => Math.Abs(c.ComputedClosing - (c.Opening + c.TotalCredit - c.TotalDebit)) > BalanceTolerance)
                .ToList();
            if (broken.Count > 0)
                throw new InvalidOperationException(
                    $"{broken.Count} customer(s) do not reconcile. Preview the file again.");

            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                var clientIdByRow = await EnsureClientsAsync(dto, result);

                await WriteInvoicesAsync(dto, clientIdByRow, result);
                await WriteReceiptsAsync(dto, clientIdByRow, result);

                result.TotalReceivable = dto.Clients.Sum(c => c.ComputedClosing);

                if (dto.SetGlCutover)
                    await SetCutoverAsync(dto, result);

                var run = new ImportRun
                {
                    CompanyId = dto.CompanyId,
                    Kind = ImportKinds.CustomerLedger,
                    ImportProfileId = dto.ImportProfileId,
                    ProfileVersion = dto.ProfileVersion,
                    FileSha256 = (dto.FileSha256 ?? "").Trim().ToLowerInvariant(),
                    OriginalFileName = Truncate(dto.FileName, 400),
                    FileSizeBytes = dto.FileSizeBytes,
                    CountsJson = JsonSerializer.Serialize(new Dictionary<string, int>
                    {
                        ["clientsCreated"] = result.ClientsCreated,
                        ["clientsReused"] = result.ClientsReused,
                        ["invoices"] = result.InvoicesCreated,
                        ["receipts"] = result.ReceiptsCreated,
                    }),
                    ImportedByUserId = userId,
                    ImportedAt = DateTime.UtcNow,
                };
                _db.ImportRuns.Add(run);
                await _db.SaveChangesAsync();

                await tx.CommitAsync();
                result.ImportRunId = run.Id;

                _logger.LogInformation(
                    "Customer ledger import into company {CompanyId}: {Clients} clients, {Invoices} invoices, {Receipts} receipts, receivable {Total}",
                    dto.CompanyId, result.ClientsCreated + result.ClientsReused,
                    result.InvoicesCreated, result.ReceiptsCreated, result.TotalReceivable);

                return result;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        /// <summary>
        /// Creates the customers that do not exist yet and returns index-row to
        /// client-id. Every new client goes through the grouping service, so the
        /// "same business under two records" behaviour works from day one rather
        /// than needing a backfill later.
        /// </summary>
        private async Task<Dictionary<int, int>> EnsureClientsAsync(
            CustomerLedgerCommitDto dto, CustomerLedgerCommitResultDto result)
        {
            var map = new Dictionary<int, int>();

            foreach (var row in dto.Clients)
            {
                if (row.ClientId.HasValue)
                {
                    // Confirm the id really is in THIS company — it arrived in
                    // the request body and a forged one must not link a document
                    // to another tenant's customer.
                    var owned = await _db.Clients.AsNoTracking()
                        .AnyAsync(c => c.Id == row.ClientId.Value && c.CompanyId == dto.CompanyId);
                    if (!owned)
                        throw new InvalidOperationException(
                            $"The customer chosen for \"{row.IndexName}\" is not in this company. Preview the file again.");

                    map[row.IndexRow] = row.ClientId.Value;
                    result.ClientsReused++;
                    continue;
                }

                var name = Truncate(string.IsNullOrWhiteSpace(row.SheetName) ? row.IndexName : row.SheetName, 200);
                var client = new Client
                {
                    Name = name,
                    CompanyId = dto.CompanyId,
                    ExternalRef = $"ledger-import:{dto.CompanyId}:{row.IndexRow}",
                    CreatedAt = DateTime.UtcNow,
                };

                _db.Clients.Add(client);
                await _db.SaveChangesAsync();

                await _groups.EnsureGroupForClientAsync(client);
                await _db.SaveChangesAsync();

                map[row.IndexRow] = client.Id;
                result.ClientsCreated++;
            }

            return map;
        }

        /// <summary>
        /// Migrated invoices: no line items, no tax split, excluded from FBR.
        /// The workbook records totals only, so <c>GSTRate</c> is 0 and the real
        /// tax position lives in the opening balances — the same shape the
        /// Manager.io importer writes, and the reason the tax reports show no
        /// output tax for an imported period.
        ///
        /// Numbers come from <see cref="MigratedDocumentNumbers"/>, NOT from the
        /// workbook. The workbook's own reference ("AA-51") is the document's
        /// identity and is kept on <c>ExternalRef</c>; spending the company's
        /// invoice sequence on imported history made the operator's configured
        /// starting number unreachable and blocked re-importing the same file.
        /// </summary>
        private async Task WriteInvoicesAsync(
            CustomerLedgerCommitDto dto, Dictionary<int, int> clientIdByRow,
            CustomerLedgerCommitResultDto result)
        {
            var batch = new List<Invoice>();
            var nextNumber = await MigratedDocumentNumbers.NextAsync(_db, dto.CompanyId);

            foreach (var inv in dto.Invoices.OrderBy(i => i.Date).ThenBy(i => i.InvoiceNumber))
            {
                if (!clientIdByRow.TryGetValue(inv.IndexRow, out var clientId)) continue;
                if (inv.Amount == 0m) continue;

                batch.Add(new Invoice
                {
                    CompanyId = dto.CompanyId,
                    ClientId = clientId,
                    InvoiceNumber = nextNumber++,
                    Date = inv.Date.Date,
                    Subtotal = inv.Amount,
                    GSTRate = 0m,
                    GSTAmount = 0m,
                    GrandTotal = inv.Amount,
                    AmountInWords = "",
                    IsMigrated = true,
                    IsFbrExcluded = true,
                    // The workbook's own reference, so the operator recognises
                    // the document, and so a re-import can match it again.
                    ExternalRef = inv.IsOpening
                        ? $"ledger-open:{dto.CompanyId}:{inv.IndexRow}"
                        : $"ledger-inv:{dto.CompanyId}:{inv.Reference ?? inv.InvoiceNumber.ToString()}",
                    CreatedAt = DateTime.UtcNow,
                });

                if (batch.Count >= 200)
                {
                    _db.Invoices.AddRange(batch);
                    await _db.SaveChangesAsync();
                    result.InvoicesCreated += batch.Count;
                    batch.Clear();
                    _db.ChangeTracker.Clear();
                }
            }

            if (batch.Count > 0)
            {
                _db.Invoices.AddRange(batch);
                await _db.SaveChangesAsync();
                result.InvoicesCreated += batch.Count;
                _db.ChangeTracker.Clear();
            }
        }

        /// <summary>
        /// Receipts carry ONE on-account allocation each. The workbook never
        /// records which invoice a payment settled, so linking them would invent
        /// a fact — the balance is right either way, and an on-account receipt
        /// can be applied to an invoice later without unpicking anything.
        /// </summary>
        private async Task WriteReceiptsAsync(
            CustomerLedgerCommitDto dto, Dictionary<int, int> clientIdByRow,
            CustomerLedgerCommitResultDto result)
        {
            var next = await _db.Payments
                .Where(p => p.CompanyId == dto.CompanyId && p.Direction == PaymentDirection.Receipt)
                .Select(p => (int?)p.Number)
                .MaxAsync() ?? 0;

            var batch = new List<Payment>();

            foreach (var rec in dto.Receipts.OrderBy(r => r.Date).ThenBy(r => r.SourceRow))
            {
                if (!clientIdByRow.TryGetValue(rec.IndexRow, out var clientId)) continue;
                if (rec.Amount == 0m) continue;

                batch.Add(new Payment
                {
                    CompanyId = dto.CompanyId,
                    Direction = PaymentDirection.Receipt,
                    Number = ++next,
                    Date = rec.Date.Date,
                    ContactType = "Client",
                    ContactId = clientId,
                    Method = string.IsNullOrWhiteSpace(rec.Method) ? "Cash" : rec.Method,
                    Description = Truncate(rec.Description, 500),
                    Amount = rec.Amount,
                    CreatedAt = DateTime.UtcNow,
                    Allocations = new List<PaymentAllocation>
                    {
                        new()
                        {
                            Kind = AllocationKind.OnAccount,
                            Amount = rec.Amount,
                        },
                    },
                });

                if (batch.Count >= 200)
                {
                    _db.Payments.AddRange(batch);
                    await _db.SaveChangesAsync();
                    result.ReceiptsCreated += batch.Count;
                    batch.Clear();
                    _db.ChangeTracker.Clear();
                }
            }

            if (batch.Count > 0)
            {
                _db.Payments.AddRange(batch);
                await _db.SaveChangesAsync();
                result.ReceiptsCreated += batch.Count;
                _db.ChangeTracker.Clear();
            }
        }

        /// <summary>
        /// Freezes the ledger at the imported period's end and loads the
        /// receivable total onto the AR control account.
        ///
        /// The lock date is NOT optional housekeeping. GeneralLedgerService
        /// refuses to enable the GL on a company that has migrated invoices AND
        /// non-zero opening balances AND no lock date — a guard that exists to
        /// stop a snapshot import being posted on top of its own opening
        /// balances. Setting it here is what keeps that path open afterwards.
        /// </summary>
        private async Task SetCutoverAsync(
            CustomerLedgerCommitDto dto, CustomerLedgerCommitResultDto result)
        {
            var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == dto.CompanyId);
            if (company == null) return;

            company.GlLockDate = dto.PeriodEnd.Date;
            await _db.SaveChangesAsync();
            result.GlLockDate = company.GlLockDate;

            var receivable = result.TotalReceivable;
            if (receivable == 0m)
            {
                result.Messages.Add($"The ledger is frozen at {dto.PeriodEnd:d MMM yyyy}.");
                return;
            }

            var ar = await _db.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == dto.CompanyId
                            && a.ControlType == ControlType.AccountsReceivable
                            && a.IsActive)
                .OrderBy(a => a.Id)
                .Select(a => new { a.Id, a.Name })
                .FirstOrDefaultAsync();

            if (ar == null)
            {
                result.Messages.Add(
                    "No Accounts receivable account was found, so the receivable total was not posted. Seed the chart of accounts, then set it by hand.");
                return;
            }

            await _accounts.AdjustOpeningBalanceAsync(ar.Id, new AdjustOpeningBalanceDto
            {
                OpeningBalance = Math.Abs(receivable),
                OpeningBalanceIsDebit = receivable >= 0m,
            });

            result.Messages.Add(
                $"{receivable:N2} posted as the opening balance on {ar.Name}, and the ledger is frozen at {dto.PeriodEnd:d MMM yyyy}.");
        }

        private static string Truncate(string? value, int max)
        {
            var v = (value ?? "").Trim();
            return v.Length <= max ? v : v[..max];
        }
    }
}
