using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Withholding Tax Receipts — the customer-issued tax certificates whose
    /// records remain separate from cash and invoice ledger posting. Numbered per company with collision-retry,
    /// tenant + cross-tenant-link guarded.
    /// </summary>
    public class WithholdingTaxReceiptService : IWithholdingTaxReceiptService
    {
        private readonly IWithholdingTaxReceiptRepository _repo;
        private readonly AppDbContext _context;
        private readonly AttachmentStorage _attachmentStorage;
        private readonly ILogger<WithholdingTaxReceiptService> _logger;

        public WithholdingTaxReceiptService(
            IWithholdingTaxReceiptRepository repo,
            AppDbContext context,
            AttachmentStorage attachmentStorage,
            ILogger<WithholdingTaxReceiptService> logger)
        {
            _repo = repo;
            _context = context;
            _attachmentStorage = attachmentStorage;
            _logger = logger;
        }

        private static WithholdingTaxReceiptDto ToDto(WithholdingTaxReceipt r, bool isLatest) => new()
        {
            Id = r.Id,
            ReceiptNumber = r.ReceiptNumber,
            CompanyId = r.CompanyId,
            ClientId = r.ClientId,
            ClientName = r.Client?.Name ?? "",
            Date = r.Date,
            Amount = r.Amount,
            Description = r.Description,
            CreatedAt = r.CreatedAt,
            IsLatest = isLatest,
        };

        public async Task<List<WithholdingTaxReceiptDto>> GetByCompanyAsync(int companyId)
        {
            var rows = await _repo.GetByCompanyAsync(companyId);
            var max = rows.Count == 0 ? 0 : rows.Max(r => r.ReceiptNumber);
            return rows.Select(r => ToDto(r, r.ReceiptNumber == max)).ToList();
        }

        public async Task<WithholdingTaxReceiptDto?> GetByIdAsync(int id)
        {
            var r = await _repo.GetByIdAsync(id);
            if (r == null) return null;
            var max = await _repo.GetMaxNumberAsync(r.CompanyId);
            return ToDto(r, r.ReceiptNumber == max);
        }

        public async Task<int> GetCountByCompanyAsync(int companyId) =>
            await _repo.GetCountByCompanyAsync(companyId);

        public async Task<PrintWithholdingReceiptDto?> GetPrintDataAsync(int id)
        {
            var r = await _context.WithholdingTaxReceipts.AsNoTracking()
                .Include(x => x.Company)
                .Include(x => x.Client)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (r == null) return null;

            return new PrintWithholdingReceiptDto
            {
                CompanyBrandName = r.Company?.BrandName ?? r.Company?.Name ?? "",
                CompanyLogoPath = r.Company?.LogoPath,
                CompanyAddress = r.Company?.FullAddress,
                CompanyPhone = r.Company?.Phone,
                CompanyNTN = r.Company?.NTN,
                CompanySTRN = r.Company?.STRN,
                ReceiptNumber = r.ReceiptNumber,
                Date = r.Date,
                CustomerName = r.Client?.Name ?? "",
                CustomerAddress = r.Client?.Address,
                CustomerNTN = r.Client?.NTN,
                CustomerSTRN = r.Client?.STRN,
                Description = r.Description,
                Amount = r.Amount,
                AmountInWords = NumberToWordsConverter.ConvertWithPaisa(r.Amount),
            };
        }

        public async Task<WithholdingTaxReceiptDto> CreateAsync(int companyId, WithholdingTaxReceiptDto dto)
        {
            await ValidateAsync(companyId, dto);

            // Numbering + insert, retried on the unique (company, number) index violation. Detach on failure so the retry doesn't
            // re-attempt the same rejected row (mirrors SalesOrderService).
            var createdId = await NumberAllocationRetry.ExecuteAsync(async _ =>
            {
                await using var tx = await _context.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
                await LockSeriesAsync(companyId);
                var max = await _repo.GetMaxNumberAsync(companyId);
                var receipt = new WithholdingTaxReceipt
                {
                    CompanyId = companyId,
                    ReceiptNumber = max + 1,
                    ClientId = dto.ClientId,
                    Date = dto.Date == default ? PakistanClock.Today : dto.Date,
                    Amount = dto.Amount,
                    Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim(),
                    CreatedAt = DateTime.UtcNow,
                };
                _context.WithholdingTaxReceipts.Add(receipt);
                try
                {
                    await _context.SaveChangesAsync();
                }
                catch (DbUpdateException)
                {
                    _context.Entry(receipt).State = EntityState.Detached;
                    throw;
                }
                await tx.CommitAsync();
                return receipt.Id;
            });

            return (await GetByIdAsync(createdId))!;
        }

        public async Task<WithholdingTaxReceiptDto?> UpdateAsync(int id, WithholdingTaxReceiptDto dto)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            var receipt = await _repo.GetByIdAsync(id);
            if (receipt == null) return null;

            // Guard against a forged CompanyId in the body — validate the new
            // client against the STORED company, never the DTO's.
            await ValidateAsync(receipt.CompanyId, dto);

            receipt.ClientId = dto.ClientId;
            receipt.Date = dto.Date == default ? receipt.Date : dto.Date;
            receipt.Amount = dto.Amount;
            receipt.Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim();
            // CompanyId and ReceiptNumber are immutable on update.

            await _repo.UpdateAsync(receipt);
            await tx.CommitAsync();
            return await GetByIdAsync(id);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            var receipt = await _repo.GetByIdAsync(id);
            if (receipt == null) return false;

            await LockSeriesAsync(receipt.CompanyId);

            // Gap-free: only the latest receipt in its company
            // series may be deleted, mirroring the other sales documents.
            var max = await _repo.GetMaxNumberAsync(receipt.CompanyId);
            if (receipt.ReceiptNumber != max)
                throw new InvalidOperationException(
                    $"Only the latest receipt (#{max}) can be deleted, to keep numbering gap-free. Edit earlier receipts instead.");

            // Remove any linked certificate attachments (no FK, so they'd
            // otherwise orphan + skew folder counts). Collect on-disk paths to
            // purge AFTER the DB delete commits.
            var atts = await _context.Attachments
                .Where(a => a.CompanyId == receipt.CompanyId
                            && a.EntityType == AttachmentEntityTypes.WithholdingTaxReceipt
                            && a.EntityId == receipt.Id)
                .ToListAsync();
            var attachmentPaths = atts.Select(a => a.StoragePath).Where(p => !string.IsNullOrEmpty(p)).ToList();
            if (atts.Count > 0) _context.Attachments.RemoveRange(atts);

            await _repo.DeleteAsync(receipt);
            await tx.CommitAsync();

            foreach (var p in attachmentPaths) _attachmentStorage.TryDelete(p);
            return true;
        }

        private Task LockSeriesAsync(int companyId) => _context.Database.ExecuteSqlInterpolatedAsync($@"
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource={"WithholdingReceipt:" + companyId},
                @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=5000;
            IF @result < 0 THROW 51000, 'Could not allocate a withholding receipt number.', 1;");

        /// <summary>
        /// Shared create/update validation: amount positive, client exists and
        /// belongs to this company (cross-tenant link guard), and belongs to the stored company.
        /// </summary>
        private async Task ValidateAsync(int companyId, WithholdingTaxReceiptDto dto)
        {
            if (dto.ClientId <= 0)
                throw new InvalidOperationException("A customer is required.");
            if (dto.Amount <= 0)
                throw new InvalidOperationException("Amount must be greater than zero.");

            var client = await _context.Clients.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == dto.ClientId);
            if (client == null)
                throw new KeyNotFoundException("Customer not found.");
            if (client.CompanyId != companyId)
                throw new InvalidOperationException("The selected customer belongs to a different company.");


        }
    }
}
