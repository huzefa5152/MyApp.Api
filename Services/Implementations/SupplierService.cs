using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class SupplierService : ISupplierService
    {
        private readonly ISupplierRepository _repo;
        private readonly ISupplierGroupService _groupService;
        private readonly AppDbContext _context;
        private readonly ILogger<SupplierService> _logger;

        public SupplierService(ISupplierRepository repo, ISupplierGroupService groupService, AppDbContext context, ILogger<SupplierService> logger)
        {
            _repo = repo;
            _groupService = groupService;
            _context = context;
            _logger = logger;
        }

        private static SupplierDto ToDto(Supplier s, bool hasPurchaseBills = false) => new()
        {
            Id = s.Id,
            Name = s.Name,
            Address = s.Address,
            Phone = s.Phone,
            Email = s.Email,
            NTN = s.NTN,
            STRN = s.STRN,
            Site = s.Site,
            RegistrationType = s.RegistrationType,
            CNIC = s.CNIC,
            FbrProvinceCode = s.FbrProvinceCode,
            CompanyId = s.CompanyId,
            SupplierGroupId = s.SupplierGroupId,
            HasPurchaseBills = hasPurchaseBills,
            CreatedAt = s.CreatedAt,
        };

        public async Task<IEnumerable<SupplierDto>> GetAllAsync()
        {
            var suppliers = (await _repo.GetAllAsync()).ToList();
            var ids = suppliers.Select(s => s.Id).ToList();
            var hasMap = await _repo.HasPurchaseBillsForSuppliersAsync(ids);
            return suppliers.Select(s => ToDto(s, hasMap.GetValueOrDefault(s.Id)));
        }

        public async Task<IEnumerable<SupplierDto>> GetByCompanyAsync(int companyId)
        {
            var suppliers = (await _repo.GetByCompanyAsync(companyId)).ToList();
            var ids = suppliers.Select(s => s.Id).ToList();
            var hasMap = await _repo.HasPurchaseBillsForSuppliersAsync(ids);
            return suppliers.Select(s => ToDto(s, hasMap.GetValueOrDefault(s.Id)));
        }

        public async Task<SupplierDto?> GetByIdAsync(int id)
        {
            var s = await _repo.GetByIdAsync(id);
            if (s == null) return null;
            var hasBills = await _repo.HasPurchaseBillsAsync(s.Id);
            return ToDto(s, hasBills);
        }

        public async Task<SupplierDto> CreateAsync(SupplierDto dto)
        {
            if (await _repo.ExistsWithNameAsync(dto.Name, dto.CompanyId))
                throw new InvalidOperationException("Supplier with this name already exists for this company.");

            var supplier = new Supplier
            {
                Name = dto.Name,
                Address = dto.Address,
                Phone = dto.Phone,
                Email = dto.Email,
                NTN = dto.NTN,
                STRN = dto.STRN,
                Site = dto.Site,
                RegistrationType = dto.RegistrationType,
                CNIC = dto.CNIC,
                FbrProvinceCode = dto.FbrProvinceCode,
                CompanyId = dto.CompanyId,
                CreatedAt = DateTime.UtcNow,
            };

            var created = await _repo.CreateAsync(supplier);

            // Attach to a Common Supplier group — find-or-create by NTN
            // (or normalised name fallback). Same defensive try/catch as
            // ClientService: grouping is a convenience layer, must never
            // break the per-company create.
            try
            {
                await _groupService.EnsureGroupForSupplierAsync(created);
                await _context.SaveChangesAsync();
            }
            catch { /* see ClientService.CreateAsync */ }

            return ToDto(created);
        }

        public async Task<CreateSupplierBatchResultDto> CreateForCompaniesAsync(CreateSupplierBatchDto dto)
        {
            var result = new CreateSupplierBatchResultDto();
            if (dto.CompanyIds == null || dto.CompanyIds.Count == 0)
                throw new InvalidOperationException("At least one company must be selected.");

            var distinctIds = dto.CompanyIds.Distinct().ToList();
            var companyNames = await _context.Companies
                .Where(c => distinctIds.Contains(c.Id))
                .ToDictionaryAsync(c => c.Id, c => c.Name);

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                foreach (var companyId in distinctIds)
                {
                    if (!companyNames.TryGetValue(companyId, out var companyName))
                    {
                        result.SkippedReasons.Add($"Company id={companyId} not found.");
                        continue;
                    }

                    if (await _repo.ExistsWithNameAsync(dto.Name, companyId))
                    {
                        result.SkippedReasons.Add(
                            $"{companyName}: a supplier named '{dto.Name}' already exists; skipped.");
                        continue;
                    }

                    var supplier = new Supplier
                    {
                        Name = dto.Name,
                        Address = dto.Address,
                        Phone = dto.Phone,
                        Email = dto.Email,
                        NTN = dto.NTN,
                        STRN = dto.STRN,
                        Site = dto.Site,
                        RegistrationType = dto.RegistrationType,
                        CNIC = dto.CNIC,
                        FbrProvinceCode = dto.FbrProvinceCode,
                        CompanyId = companyId,
                        CreatedAt = DateTime.UtcNow,
                    };
                    var created = await _repo.CreateAsync(supplier);

                    try
                    {
                        var grp = await _groupService.EnsureGroupForSupplierAsync(created);
                        await _context.SaveChangesAsync();
                        result.SupplierGroupId = grp.Id;
                    }
                    catch { /* grouping failure must not block create */ }

                    result.Created.Add(ToDto(created));
                }

                await tx.CommitAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SupplierService: transaction rolled back");
                await tx.RollbackAsync();
                throw;
            }

            return result;
        }

        public async Task<CreateSupplierBatchResultDto> CopyToCompaniesAsync(int sourceSupplierId, List<int> targetCompanyIds)
        {
            if (targetCompanyIds == null || targetCompanyIds.Count == 0)
                throw new InvalidOperationException("At least one target company must be selected.");

            var source = await _repo.GetByIdAsync(sourceSupplierId)
                ?? throw new KeyNotFoundException("Source supplier not found.");

            var cleanTargets = targetCompanyIds
                .Where(id => id != source.CompanyId)
                .Distinct()
                .ToList();

            if (cleanTargets.Count == 0)
                throw new InvalidOperationException("No valid target companies to copy into (cannot copy a supplier into its own company).");

            // Same delegation pattern as ClientService.CopyToCompaniesAsync:
            // CreateForCompaniesAsync already handles transactions, name
            // collisions, and EnsureGroupForSupplierAsync auto-linking, so
            // every new row lands on the same SupplierGroup as the source.
            var batch = new CreateSupplierBatchDto
            {
                Name = source.Name,
                Address = source.Address,
                Phone = source.Phone,
                Email = source.Email,
                NTN = source.NTN,
                STRN = source.STRN,
                Site = source.Site,
                RegistrationType = source.RegistrationType,
                CNIC = source.CNIC,
                FbrProvinceCode = source.FbrProvinceCode,
                CompanyIds = cleanTargets,
            };
            return await CreateForCompaniesAsync(batch);
        }

        public async Task<SupplierDto> UpdateAsync(SupplierDto dto)
        {
            if (dto.Id == null) throw new ArgumentException("Supplier ID is required for update.");

            var supplier = await _repo.GetByIdAsync(dto.Id.Value);
            if (supplier == null) throw new KeyNotFoundException("Supplier not found.");

            if (await _repo.ExistsWithNameAsync(dto.Name, supplier.CompanyId, dto.Id))
                throw new InvalidOperationException("Supplier with this name already exists for this company.");

            supplier.Name = dto.Name;
            supplier.Address = dto.Address;
            supplier.Phone = dto.Phone;
            supplier.Email = dto.Email;
            supplier.NTN = dto.NTN;
            supplier.STRN = dto.STRN;
            supplier.Site = dto.Site;
            supplier.RegistrationType = dto.RegistrationType;
            supplier.CNIC = dto.CNIC;
            supplier.FbrProvinceCode = dto.FbrProvinceCode;

            var hasBills = await _repo.HasPurchaseBillsAsync(supplier.Id);
            await _repo.UpdateAsync(supplier);

            // Re-evaluate Common Supplier grouping. NTN / Name might
            // have just changed, which moves the supplier from one
            // group to another (or creates a new group). Same
            // defensive try/catch as Create.
            try
            {
                await _groupService.EnsureGroupForSupplierAsync(supplier);
                await _context.SaveChangesAsync();
            }
            catch { /* see CreateAsync */ }

            return ToDto(supplier, hasBills);
        }

        public async Task DeleteAsync(int id)
        {
            var supplier = await _repo.GetByIdAsync(id);
            if (supplier == null) return;

            // Full cascade (parity with ClientService.DeleteAsync) — a supplier
            // with purchase bills / goods receipts USED to be undeletable (hard
            // guard). Now it removes the whole purchase-side subtree in one
            // transaction: AP receipts + allocations, the GL entries posted from
            // the bills/payments, attachments, stock movements, goods receipts,
            // purchase bills, then the supplier. Order is children-first so no
            // Restrict FK trips.
            var companyId = supplier.CompanyId;
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var billIds = await _context.PurchaseBills.Where(pb => pb.SupplierId == id).Select(pb => pb.Id).ToListAsync();
                var grIds = await _context.GoodsReceipts.Where(gr => gr.SupplierId == id).Select(gr => gr.Id).ToListAsync();

                // 1. Payments (AP) — allocations against this supplier's bills
                //    FK-block the bill delete (FK_PaymentAllocations_PurchaseBills);
                //    then the supplier's own payment headers.
                var supplierPaymentIds = await _context.Payments
                    .Where(p => p.ContactType == "Supplier" && p.ContactId == id)
                    .Select(p => p.Id).ToListAsync();
                if (billIds.Count > 0)
                    await _context.PaymentAllocations
                        .Where(a => a.PurchaseBillId != null && billIds.Contains(a.PurchaseBillId.Value))
                        .ExecuteDeleteAsync();
                if (supplierPaymentIds.Count > 0)
                {
                    await _context.PaymentAllocations.Where(a => supplierPaymentIds.Contains(a.PaymentId)).ExecuteDeleteAsync();
                    await _context.Payments.Where(p => supplierPaymentIds.Contains(p.Id)).ExecuteDeleteAsync();
                }

                // 2. GL journal entries posted from the bills + payments.
                if (billIds.Count > 0 || supplierPaymentIds.Count > 0)
                {
                    var jeIds = await _context.JournalEntries
                        .Where(je =>
                            (je.SourceDocType == MyApp.Api.Models.Accounting.SourceDocType.PurchaseBill && je.SourceDocId != null && billIds.Contains(je.SourceDocId.Value)) ||
                            (je.SourceDocType == MyApp.Api.Models.Accounting.SourceDocType.Payment && je.SourceDocId != null && supplierPaymentIds.Contains(je.SourceDocId.Value)))
                        .Select(je => je.Id).ToListAsync();
                    if (jeIds.Count > 0)
                    {
                        await _context.JournalLines.Where(l => jeIds.Contains(l.JournalEntryId)).ExecuteDeleteAsync();
                        await _context.JournalEntries.Where(je => jeIds.Contains(je.Id)).ExecuteDeleteAsync();
                    }
                }

                // 3. Attachments on the bills / goods receipts (DB rows; bytes on
                //    disk are left for the attachment reconciler — same stance as
                //    CompanyService.DeleteAsync).
                if (billIds.Count > 0 || grIds.Count > 0)
                    await _context.Attachments
                        .Where(a => a.CompanyId == companyId && a.EntityType != null && a.EntityId != null && (
                            (a.EntityType == "PurchaseBill" && billIds.Contains(a.EntityId.Value)) ||
                            (a.EntityType == "GoodsReceipt" && grIds.Contains(a.EntityId.Value))))
                        .ExecuteDeleteAsync();

                // 4. Goods receipts (+ items + their stock movements). Before bills,
                //    which a receipt can reference.
                if (grIds.Count > 0)
                {
                    await _context.StockMovements
                        .Where(m => m.CompanyId == companyId && m.SourceType == StockMovementSourceType.GoodsReceipt && m.SourceId != null && grIds.Contains(m.SourceId.Value))
                        .ExecuteDeleteAsync();
                    await _context.GoodsReceiptItems.Where(gri => grIds.Contains(gri.GoodsReceiptId)).ExecuteDeleteAsync();
                    await _context.GoodsReceipts.Where(gr => gr.SupplierId == id).ExecuteDeleteAsync();
                }

                // 5. Purchase bills (+ items + source lines + their stock IN).
                if (billIds.Count > 0)
                {
                    await _context.StockMovements
                        .Where(m => m.CompanyId == companyId && m.SourceType == StockMovementSourceType.PurchaseBill && m.SourceId != null && billIds.Contains(m.SourceId.Value))
                        .ExecuteDeleteAsync();
                    var itemIds = await _context.PurchaseItems.Where(pi => billIds.Contains(pi.PurchaseBillId)).Select(pi => pi.Id).ToListAsync();
                    if (itemIds.Count > 0)
                        await _context.PurchaseItemSourceLines.Where(sl => itemIds.Contains(sl.PurchaseItemId)).ExecuteDeleteAsync();
                    await _context.PurchaseItems.Where(pi => billIds.Contains(pi.PurchaseBillId)).ExecuteDeleteAsync();
                    await _context.PurchaseBills.Where(pb => pb.SupplierId == id).ExecuteDeleteAsync();
                }

                // 6. Finally the supplier.
                await _repo.DeleteAsync(supplier);
                await tx.CommitAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SupplierService: delete-supplier transaction rolled back for supplierId={SupplierId}", id);
                await tx.RollbackAsync();
                throw;
            }
        }

        // ── Payables roll-up + ledger ────────────────────────────────────────
        // The mirror of the client summary/statement. Both read the SAME two
        // sources a supplier's position comes from: their purchase bills, and the
        // payments tagged to them. Reading bills alone is what made advances
        // invisible on the customer side.

        public async Task<List<SupplierSummaryDto>> GetSummaryAsync(int companyId)
        {
            var suppliers = await _context.Suppliers.AsNoTracking()
                .Where(s => s.CompanyId == companyId)
                .Select(s => new { s.Id, s.Name })
                .ToListAsync();
            if (suppliers.Count == 0) return new List<SupplierSummaryDto>();

            // Owed per supplier, and how many bills still carry a balance.
            var bills = await _context.PurchaseBills.AsNoTracking()
                .Where(b => b.CompanyId == companyId)
                .Select(b => new
                {
                    b.SupplierId,
                    Due = b.GrandTotal - b.WithholdingTaxAmount - b.AmountPaid,
                    b.AmountPaid,
                })
                .ToListAsync();

            var owedByBills = bills.GroupBy(b => b.SupplierId)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.Due));
            var openBills = bills.Where(b => b.Due > 0.005m).GroupBy(b => b.SupplierId)
                .ToDictionary(g => g.Key, g => g.Count());
            var partPaid = bills.Where(b => b.Due > 0.005m && b.AmountPaid > 0.005m)
                .Select(b => b.SupplierId).ToHashSet();

            // Money sitting with the supplier on account (no bill yet): an advance
            // we paid is a debit that reduces what we owe; a refund they sent back
            // is a credit that increases it again. Bill-settling payments are
            // already inside AmountPaid, so only the UNAPPLIED movement is folded
            // in here — counting every payment would double-count.
            var onAccount = await PartyOnAccount.NetByPartyAsync(_context, companyId, receivables: false);

            return suppliers.Select(s =>
            {
                var payable = owedByBills.GetValueOrDefault(s.Id) + onAccount.GetValueOrDefault(s.Id);
                var open = openBills.GetValueOrDefault(s.Id);
                // Nothing outstanding — or we are in credit — reads as Paid.
                var status = payable <= 0.005m ? "Paid"
                           : partPaid.Contains(s.Id) ? "Partial"
                           : "Unpaid";
                return new SupplierSummaryDto
                {
                    SupplierId = s.Id,
                    SupplierName = s.Name,
                    AccountsPayable = payable,
                    OpenBills = open,
                    Status = status,
                };
            }).ToList();
        }

        public async Task<SupplierStatementDto> GetStatementAsync(int supplierId, string supplierName)
        {
            const int CAP = 200;
            var entries = new List<SupplierStatementEntryDto>();

            // Credits — purchase bills increase what we owe.
            var bills = await _context.PurchaseBills.AsNoTracking()
                .Where(b => b.SupplierId == supplierId)
                .Select(b => new { b.Id, b.PurchaseBillNumber, b.Date, b.GrandTotal, b.WithholdingTaxAmount })
                .ToListAsync();
            foreach (var b in bills)
                entries.Add(new SupplierStatementEntryDto
                {
                    Date = b.Date,
                    Type = "Purchase Bill",
                    Reference = "BILL-" + b.PurchaseBillNumber,
                    DocId = b.Id,
                    // We owe the collectible: the withheld slice goes to FBR, not them.
                    Credit = b.GrandTotal - b.WithholdingTaxAmount,
                });

            // Debits — payments allocated to this supplier's bills. Found through
            // the bill, so Σ debits == Σ bill AmountPaid.
            var allocs = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                join bill in _context.PurchaseBills.AsNoTracking() on a.PurchaseBillId equals bill.Id
                where a.PurchaseBillId != null && bill.SupplierId == supplierId
                      && p.Direction == Models.Accounting.PaymentDirection.Payment && !p.IsCancelled
                select new { p.Number, p.Date, p.BankAccountName, p.Description, a.Amount, a.AdjustmentAmount, AdjustmentAccountName = a.AdjustmentAccount != null ? a.AdjustmentAccount.Name : null, a.Id }
            ).ToListAsync();
            foreach (var a in allocs)
            {
                if (a.Amount != 0m)
                    entries.Add(new SupplierStatementEntryDto
                    {
                        Date = a.Date, Type = "Payment", Reference = "PMT-" + a.Number, DocId = a.Id,
                        BankAccount = a.BankAccountName, Description = a.Description, Debit = a.Amount,
                    });

                // A settle-remainder write-off (a discount they gave us) clears the
                // bill exactly as cash does, so it must show here or the ledger
                // disagrees with the payables column by the amount written off.
                if (a.AdjustmentAmount != 0m)
                    entries.Add(new SupplierStatementEntryDto
                    {
                        Date = a.Date,
                        Type = a.AdjustmentAccountName != null ? $"Written off — {a.AdjustmentAccountName}" : "Written off",
                        Reference = "PMT-" + a.Number,
                        DocId = a.Id,
                        Description = a.Description,
                        Debit = a.AdjustmentAmount,
                    });
            }

            // On-account movements — no document, so they are found by the party
            // named on the payment (see PartyOnAccount for what counts). An advance
            // we paid reduces what we owe; a refund they sent back increases it.
            var onAccount = await PartyOnAccount
                .Query(_context, "Supplier", partyIds: new[] { supplierId }).ToListAsync();
            foreach (var a in onAccount.Where(r => r.Amount != 0m))
            {
                var isPayment = a.Direction == Models.Accounting.PaymentDirection.Payment;
                entries.Add(new SupplierStatementEntryDto
                {
                    Date = a.Date,
                    Type = isPayment ? "Advance paid" : "Refund received",
                    Reference = (isPayment ? "PMT-" : "RCP-") + a.Number,
                    DocId = a.PaymentId,
                    BankAccount = a.BankAccountName,
                    Description = a.Description,
                    Debit = isPayment ? a.Amount : 0m,
                    Credit = isPayment ? 0m : a.Amount,
                });
            }

            // Running amount owed, oldest → newest. On the same date a bill lands
            // before the payment that settles it, mirroring the customer statement.
            var ordered = entries.OrderBy(e => e.Date).ThenByDescending(e => e.Credit).ToList();
            decimal bal = 0m;
            foreach (var e in ordered) { bal += e.Credit - e.Debit; e.Balance = bal; }

            var total = ordered.Count;
            ordered.Reverse();   // newest-first for display
            var shown = ordered.Take(CAP).ToList();

            return new SupplierStatementDto
            {
                SupplierId = supplierId,
                SupplierName = supplierName,
                ClosingBalance = bal,
                Total = total,
                Capped = total > shown.Count,
                Entries = shown,
            };
        }
    }
}
