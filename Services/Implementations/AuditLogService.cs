using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class AuditLogService : IAuditLogService
    {
        private readonly IAuditLogRepository _repository;
        private readonly AppDbContext _db;
        private readonly ILogger<AuditLogService> _logger;

        // Audit H-8 (2026-05-08): same fingerprint within this window
        // increments OccurrenceCount on the existing row instead of
        // inserting a fresh one. Keeps the audit table sane during
        // FBR brownouts that produce hundreds of identical errors.
        private static readonly TimeSpan DedupWindow = TimeSpan.FromMinutes(5);

        public AuditLogService(IAuditLogRepository repository, AppDbContext db, ILogger<AuditLogService> logger)
        {
            _repository = repository;
            _db = db;
            _logger = logger;
        }

        // Audit C-10 (2026-05-13): default list-shape DTO STRIPS StackTrace.
        // The operator UI doesn't need the full stack; surface it only via
        // the per-row detail endpoint (which renders a separate UI tab and
        // is gated by an extra permission below).
        private static AuditLogDto ToListDto(AuditLog a) => new()
        {
            Id = a.Id,
            Timestamp = a.Timestamp,
            Level = a.Level,
            UserName = a.UserName,
            HttpMethod = a.HttpMethod,
            RequestPath = a.RequestPath,
            StatusCode = a.StatusCode,
            ExceptionType = a.ExceptionType,
            Message = a.Message,
            StackTrace = null,
            RequestBody = a.RequestBody,
            QueryString = a.QueryString
        };

        // Detail-shape DTO keeps StackTrace for the per-row drill-through.
        private static AuditLogDto ToDetailDto(AuditLog a) => new()
        {
            Id = a.Id,
            Timestamp = a.Timestamp,
            Level = a.Level,
            UserName = a.UserName,
            HttpMethod = a.HttpMethod,
            RequestPath = a.RequestPath,
            StatusCode = a.StatusCode,
            ExceptionType = a.ExceptionType,
            Message = a.Message,
            StackTrace = a.StackTrace,
            RequestBody = a.RequestBody,
            QueryString = a.QueryString
        };

        public async Task LogAsync(AuditLog log)
        {
            try
            {
                // Compute the dedup fingerprint if the caller didn't supply one.
                // SHA1 is plenty for in-app dedup keys (not cryptographic).
                if (string.IsNullOrEmpty(log.Fingerprint))
                    log.Fingerprint = ComputeFingerprint(log);

                if (log.FirstOccurrence == null) log.FirstOccurrence = log.Timestamp;
                if (log.LastOccurrence == null) log.LastOccurrence = log.Timestamp;

                // Audit M-4 (2026-05-13): wrap the find-then-update dedup
                // path in a SERIALIZABLE transaction so two concurrent
                // LogAsync calls with the same fingerprint don't both
                // miss the existing row and insert duplicate parents. The
                // window is tiny (one read + one write) so the SERIALIZABLE
                // contention cost stays bounded.
                await using var tx = await _db.Database.BeginTransactionAsync(
                    System.Data.IsolationLevel.Serializable);
                try
                {
                    var since = log.Timestamp - DedupWindow;
                    var existing = await _db.AuditLogs
                        .Where(a => a.Fingerprint == log.Fingerprint && a.LastOccurrence >= since)
                        .OrderByDescending(a => a.Id)
                        .FirstOrDefaultAsync();

                    if (existing != null)
                    {
                        existing.OccurrenceCount += 1;
                        existing.LastOccurrence = log.Timestamp;
                        await _db.SaveChangesAsync();
                        await tx.CommitAsync();
                        return;
                    }

                    await _repository.CreateAsync(log);
                    await tx.CommitAsync();
                }
                catch
                {
                    await tx.RollbackAsync();
                    throw;
                }
            }
            catch (Exception ex)
            {
                // Logging must never crash the app — fall through to the
                // file sink so the failure isn't silent.
                _logger.LogWarning(ex, "AuditLog persist failed (level={Level}, path={Path})", log.Level, log.RequestPath);
            }
        }

        // Stable hash over the dimensions that define "the same kind of error".
        // Path is included so a flood of "/api/invoices/12 → 500" doesn't hide
        // a separate flood on /api/clients. Message is normalised (variable
        // numbers stripped) to avoid one fingerprint per primary key.
        private static string ComputeFingerprint(AuditLog log)
        {
            var msgNormalised = System.Text.RegularExpressions.Regex.Replace(
                log.Message ?? "", @"\d+", "#");
            var raw = $"{log.Level}|{log.ExceptionType}|{msgNormalised}|{log.RequestPath}|{log.StatusCode}";
            using var sha = SHA1.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
            return Convert.ToHexString(bytes).ToLowerInvariant()[..40];
        }

        public async Task<PagedResult<AuditLogDto>> GetPagedAsync(int page, int pageSize, string? level = null, string? search = null)
        {
            var result = await _repository.GetPagedAsync(page, pageSize, level, search);
            return new PagedResult<AuditLogDto>
            {
                Items = result.Items.Select(ToListDto).ToList(),
                TotalCount = result.TotalCount,
                Page = result.Page,
                PageSize = result.PageSize
            };
        }

        public async Task<AuditLogDto?> GetByIdAsync(int id)
        {
            var log = await _repository.GetByIdAsync(id);
            return log == null ? null : ToDetailDto(log);
        }

        public async Task<AuditSummaryDto> GetSummaryAsync()
        {
            return new AuditSummaryDto
            {
                ErrorsLast24h = await _repository.GetCountByLevelAsync("Error", 24),
                WarningsLast24h = await _repository.GetCountByLevelAsync("Warning", 24)
            };
        }
    }
}
