using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class FbrCommunicationLogService : IFbrCommunicationLogService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<FbrCommunicationLogService> _logger;

        public FbrCommunicationLogService(AppDbContext context, ILogger<FbrCommunicationLogService> logger)
        {
            _context = context;
            _logger = logger;
        }

        public async Task LogAsync(FbrCommunicationLog row)
        {
            try
            {
                // Hard cap on body sizes — we already redact in FbrService,
                // but a malicious / runaway response could still be huge.
                if (row.RequestBodyMasked != null && row.RequestBodyMasked.Length > 8000)
                    row.RequestBodyMasked = row.RequestBodyMasked[..8000] + "...(truncated)";
                if (row.ResponseBodyMasked != null && row.ResponseBodyMasked.Length > 8000)
                    row.ResponseBodyMasked = row.ResponseBodyMasked[..8000] + "...(truncated)";

                _context.FbrCommunicationLogs.Add(row);
                await _context.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                // FBR call already happened — logging must never break it.
                // Falls through to the file sink so the failure isn't silent.
                _logger.LogWarning(ex,
                    "FbrCommunicationLog insert failed (action={Action}, invoice={InvoiceId})",
                    row.Action, row.InvoiceId);
            }
        }

        public async Task<PagedResult<FbrCommunicationLogDto>> GetPagedAsync(
            int page, int pageSize,
            int? companyId = null,
            string? action = null,
            string? status = null,
            int? invoiceId = null,
            DateTime? since = null,
            DateTime? until = null,
            IReadOnlyCollection<int>? accessibleCompanyIds = null)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 200);

            var q = _context.FbrCommunicationLogs.AsNoTracking().AsQueryable();
            if (companyId.HasValue)
            {
                q = q.Where(f => f.CompanyId == companyId.Value);
            }
            else if (accessibleCompanyIds != null)
            {
                // Tenant scope on the no-companyId branch (audit C-2).
                var ids = accessibleCompanyIds.ToList();
                q = q.Where(f => ids.Contains(f.CompanyId));
            }
            if (!string.IsNullOrWhiteSpace(action)) q = q.Where(f => f.Action == action);
            if (!string.IsNullOrWhiteSpace(status)) q = q.Where(f => f.Status == status);
            if (invoiceId.HasValue) q = q.Where(f => f.InvoiceId == invoiceId.Value);
            if (since.HasValue) q = q.Where(f => f.Timestamp >= since.Value);
            if (until.HasValue) q = q.Where(f => f.Timestamp <= until.Value);

            var total = await q.CountAsync();
            var items = await q
                .OrderByDescending(f => f.Timestamp)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(f => ToDto(f))
                .ToListAsync();

            await ResolveInvoiceNumbersAsync(items);

            return new PagedResult<FbrCommunicationLogDto>
            {
                Items = items,
                TotalCount = total,
                Page = page,
                PageSize = pageSize,
            };
        }

        public async Task<FbrCommunicationLogDto?> GetByIdAsync(long id)
        {
            var row = await _context.FbrCommunicationLogs.AsNoTracking()
                .FirstOrDefaultAsync(f => f.Id == id);
            if (row == null) return null;
            var dto = ToDto(row);
            await ResolveInvoiceNumbersAsync(new List<FbrCommunicationLogDto> { dto });
            return dto;
        }

        // Resolve each row's InvoiceId → the invoice's real sequence number (the
        // number driven by the company's Starting/Current InvoiceNumber) in ONE
        // batch query, so the monitor shows the bill/invoice number the operator
        // recognises rather than the raw DB id. Left null when the invoice no
        // longer exists (deleted) or the log isn't tied to one.
        private async Task ResolveInvoiceNumbersAsync(List<FbrCommunicationLogDto> items)
        {
            var ids = items.Where(i => i.InvoiceId.HasValue)
                           .Select(i => i.InvoiceId!.Value)
                           .Distinct()
                           .ToList();
            if (ids.Count == 0) return;

            var map = await _context.Invoices.AsNoTracking()
                .Where(inv => ids.Contains(inv.Id))
                .Select(inv => new { inv.Id, inv.InvoiceNumber })
                .ToDictionaryAsync(x => x.Id, x => x.InvoiceNumber);

            foreach (var it in items)
                if (it.InvoiceId.HasValue && map.TryGetValue(it.InvoiceId.Value, out var n))
                    it.InvoiceNumber = n;
        }

        public async Task<FbrCommunicationSummaryDto> GetSummaryAsync(
            int? companyId,
            DateTime since,
            IReadOnlyCollection<int>? accessibleCompanyIds = null)
        {
            var q = _context.FbrCommunicationLogs.AsNoTracking()
                .Where(f => f.Timestamp >= since);
            if (companyId.HasValue)
            {
                q = q.Where(f => f.CompanyId == companyId.Value);
            }
            else if (accessibleCompanyIds != null)
            {
                var ids = accessibleCompanyIds.ToList();
                q = q.Where(f => ids.Contains(f.CompanyId));
            }

            // Aggregate in one trip via group-by status.
            var byStatus = await q
                .GroupBy(f => f.Status)
                .Select(g => new { Status = g.Key, Count = g.Count() })
                .ToListAsync();

            var rows = await q
                .Where(f => f.RequestDurationMs > 0)
                .Select(f => f.RequestDurationMs)
                .ToListAsync();

            var topErrors = await q
                .Where(f => f.FbrErrorCode != null && f.FbrErrorCode != "")
                .GroupBy(f => f.FbrErrorCode!)
                .Select(g => new { Code = g.Key, Count = g.Count() })
                .OrderByDescending(x => x.Count)
                .Take(5)
                .ToListAsync();

            int Get(string s) => byStatus.FirstOrDefault(x => x.Status == s)?.Count ?? 0;

            return new FbrCommunicationSummaryDto
            {
                Since = since,
                TotalCalls = byStatus.Sum(s => s.Count),
                Submitted = Get("submitted"),
                Acknowledged = Get("acknowledged"),
                Rejected = Get("rejected"),
                Failed = Get("failed"),
                Uncertain = Get("uncertain"),
                AvgDurationMs = rows.Count > 0 ? rows.Average() : 0,
                TopErrorCodes = topErrors.ToDictionary(x => x.Code, x => x.Count),
            };
        }

        private static FbrCommunicationLogDto ToDto(FbrCommunicationLog f) => new()
        {
            Id = f.Id,
            Timestamp = f.Timestamp,
            CompanyId = f.CompanyId,
            InvoiceId = f.InvoiceId,
            CorrelationId = f.CorrelationId,
            Action = f.Action,
            Endpoint = f.Endpoint,
            HttpMethod = f.HttpMethod,
            HttpStatusCode = f.HttpStatusCode,
            Status = f.Status,
            FbrErrorCode = f.FbrErrorCode,
            FbrErrorMessage = f.FbrErrorMessage,
            RequestDurationMs = f.RequestDurationMs,
            RetryAttempt = f.RetryAttempt,
            RequestBodyMasked = f.RequestBodyMasked,
            ResponseBodyMasked = f.ResponseBodyMasked,
            UserName = f.UserName,
        };
    }
}
