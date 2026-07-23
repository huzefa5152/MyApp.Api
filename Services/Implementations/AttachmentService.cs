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
    /// The single attachment service for the whole ERP — backs both the folder
    /// document library and every transaction module's attachments. Every read,
    /// delete, and download is keyed by id and surfaces the row's CompanyId so
    /// the controller can assert tenant access; uploads validate that a supplied
    /// folder / entity belongs to the caller's company. (Division-free in master.)
    /// </summary>
    public class AttachmentService : IAttachmentService
    {
        private readonly IAttachmentRepository _repository;
        private readonly IFolderRepository _folderRepository;
        private readonly AttachmentStorage _storage;
        private readonly AppDbContext _context;
        private readonly ILogger<AttachmentService> _logger;
        private readonly long _maxBytes;

        public AttachmentService(
            IAttachmentRepository repository,
            IFolderRepository folderRepository,
            AttachmentStorage storage,
            AppDbContext context,
            IConfiguration configuration,
            ILogger<AttachmentService> logger)
        {
            _repository = repository;
            _folderRepository = folderRepository;
            _storage = storage;
            _context = context;
            _logger = logger;
            _maxBytes = configuration.GetValue<long>("Attachments:MaxFileBytes", AttachmentFileValidator.DefaultMaxBytes);
        }

        public async Task<AttachmentDto> UploadAsync(int companyId, IFormFile file, int? folderId, string? entityType, int? entityId, int userId)
        {
            var validationError = AttachmentFileValidator.Validate(file, _maxBytes);
            if (validationError != null)
                throw new InvalidOperationException(validationError);

            // A supplied folder must belong to this company (tenant guard). Its
            // name is also the on-disk bucket the file is stored under.
            string? folderName = null;
            if (folderId.HasValue)
            {
                var folder = await _folderRepository.GetByIdAsync(folderId.Value)
                    ?? throw new InvalidOperationException("Folder not found.");
                if (folder.CompanyId != companyId)
                    throw new InvalidOperationException("Folder does not belong to this company.");
                folderName = folder.Name;
            }

            // A supplied entity link must be a known type with a real id.
            string? canonicalEntity = null;
            if (!string.IsNullOrWhiteSpace(entityType))
            {
                canonicalEntity = AttachmentEntityTypes.Canonical(entityType)
                    ?? throw new InvalidOperationException("Unsupported attachment entity type.");
                if (!entityId.HasValue || entityId.Value <= 0)
                    throw new InvalidOperationException("An entity id is required when linking an attachment to a record.");

                // Cross-tenant link guard (CLAUDE.md §4): the referenced record
                // must exist IN THIS COMPANY — a forged entityId must not create
                // a dangling link pointing at another tenant's document.
                var id = entityId.Value;
                var exists = canonicalEntity switch
                {
                    AttachmentEntityTypes.SalesQuote => await _context.SalesQuotes.AnyAsync(x => x.Id == id && x.CompanyId == companyId),
                    AttachmentEntityTypes.SalesOrder => await _context.SalesOrders.AnyAsync(x => x.Id == id && x.CompanyId == companyId),
                    AttachmentEntityTypes.DeliveryChallan => await _context.DeliveryChallans.AnyAsync(x => x.Id == id && x.CompanyId == companyId),
                    AttachmentEntityTypes.Invoice => await _context.Invoices.AnyAsync(x => x.Id == id && x.CompanyId == companyId),
                    AttachmentEntityTypes.PurchaseBill => await _context.PurchaseBills.AnyAsync(x => x.Id == id && x.CompanyId == companyId),
                    AttachmentEntityTypes.GoodsReceipt => await _context.GoodsReceipts.AnyAsync(x => x.Id == id && x.CompanyId == companyId),
                    AttachmentEntityTypes.Payment => await _context.Payments.AnyAsync(x => x.Id == id && x.CompanyId == companyId),
                    _ => false,
                };
                if (!exists)
                    throw new InvalidOperationException("The linked record was not found in this company.");
            }

            // Group on disk by folder name (or "Uncategorized") — mirrors the
            // folders the operator sees; no companyId / date directories.
            var stored = await _storage.SaveAsync(folderName, file);
            try
            {
                var attachment = new Attachment
                {
                    CompanyId = companyId,
                    FolderId = folderId,
                    EntityType = canonicalEntity,
                    EntityId = canonicalEntity != null ? entityId : null,
                    FileName = SanitizeFileName(file.FileName),
                    StoredFileName = stored.StoredFileName,
                    StoragePath = stored.StoragePath,
                    ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
                    FileExtension = stored.Extension,
                    FileSizeBytes = file.Length,
                    ContentSha256 = stored.Sha256,
                    UploadedByUserId = userId > 0 ? userId : null
                };
                await _repository.AddAsync(attachment);

                // Reload with includes so the DTO carries folder + uploader names.
                var saved = await _repository.GetByIdAsync(attachment.Id);
                return AttachmentMapper.ToDto(saved!);
            }
            catch
            {
                // Compensating action: the DB row never landed, so drop the
                // orphaned file rather than leaking bytes onto disk.
                _storage.TryDelete(stored.StoragePath);
                throw;
            }
        }

        public async Task<List<AttachmentDto>> GetByFolderAsync(int companyId, int folderId, string? source = null)
        {
            var rows = await ReconcileAsync(await _repository.GetByFolderAsync(companyId, folderId));
            return await BuildSourceAwareDtosAsync(rows, source);
        }

        public async Task<List<AttachmentDto>> GetUncategorizedAsync(int companyId, string? source = null)
        {
            var rows = await ReconcileAsync(await _repository.GetUncategorizedAsync(companyId));
            return await BuildSourceAwareDtosAsync(rows, source);
        }

        public async Task<Dictionary<string, int>> GetFolderSourceSummaryAsync(int companyId, int folderId)
            => SourceSummary(await ReconcileAsync(await _repository.GetByFolderAsync(companyId, folderId)));

        public async Task<Dictionary<string, int>> GetUncategorizedSourceSummaryAsync(int companyId)
            => SourceSummary(await ReconcileAsync(await _repository.GetUncategorizedAsync(companyId)));

        // Maps rows → DTOs, resolves each file's source (number + label), then
        // applies the optional server-side source filter. Filtering happens after
        // reconcile so a folder's listing and its summary counts always agree.
        private async Task<List<AttachmentDto>> BuildSourceAwareDtosAsync(List<Attachment> rows, string? source)
        {
            var dtos = rows.Select(AttachmentMapper.ToDto).ToList();
            await AttachmentSourceResolver.PopulateAsync(_context, dtos);

            var key = NormalizeSource(source);
            if (key == null) return dtos;                                  // All
            if (key == AttachmentEntityTypes.DirectSource)
                return dtos.Where(d => string.IsNullOrEmpty(d.EntityType)).ToList();
            return dtos.Where(d => d.EntityType == key).ToList();
        }

        // Group reconciled rows by origin: "Direct" (no entity) or the EntityType.
        private static Dictionary<string, int> SourceSummary(List<Attachment> rows) =>
            rows.GroupBy(a => string.IsNullOrEmpty(a.EntityType) ? AttachmentEntityTypes.DirectSource : a.EntityType!)
                .ToDictionary(g => g.Key, g => g.Count());

        // null = no filter (All). "Direct" passes through. A known entity type is
        // canonicalized. Anything else (unknown/garbage) falls back to All.
        private static string? NormalizeSource(string? source)
        {
            if (string.IsNullOrWhiteSpace(source)) return null;
            var s = source.Trim();
            if (string.Equals(s, "All", StringComparison.OrdinalIgnoreCase)) return null;
            if (string.Equals(s, AttachmentEntityTypes.DirectSource, StringComparison.OrdinalIgnoreCase))
                return AttachmentEntityTypes.DirectSource;
            return AttachmentEntityTypes.Canonical(s);                     // null if unknown → All
        }

        public async Task<List<AttachmentDto>> GetByEntityAsync(int companyId, string entityType, int entityId)
        {
            var canonical = AttachmentEntityTypes.Canonical(entityType);
            if (canonical == null) return new List<AttachmentDto>();
            var rows = await ReconcileAsync(await _repository.GetByEntityAsync(companyId, canonical, entityId));
            return rows.Select(AttachmentMapper.ToDto).ToList();
        }

        public async Task<Dictionary<int, int>> GetCountsByEntityAsync(int companyId, string entityType, IEnumerable<int> entityIds)
        {
            var canonical = AttachmentEntityTypes.Canonical(entityType);
            if (canonical == null) return new Dictionary<int, int>();
            var rows = await ReconcileAsync(await _repository.GetByEntityIdsAsync(companyId, canonical, entityIds));
            return rows.Where(r => r.EntityId.HasValue)
                       .GroupBy(r => r.EntityId!.Value)
                       .ToDictionary(g => g.Key, g => g.Count());
        }

        public async Task<Dictionary<int, int>> GetCountsByFolderAsync(int companyId, IEnumerable<int> folderIds)
        {
            var rows = await ReconcileAsync(await _repository.GetByFolderIdsAsync(companyId, folderIds));
            return rows.Where(r => r.FolderId.HasValue)
                       .GroupBy(r => r.FolderId!.Value)
                       .ToDictionary(g => g.Key, g => g.Count());
        }

        /// <summary>
        /// Self-heals manual disk deletions: drops attachments whose file is no
        /// longer on disk and deletes those orphan rows, so counts and listings
        /// reflect what's actually present. Guarded on the storage root existing
        /// so an unavailable/unmounted store can't nuke every row.
        /// </summary>
        private async Task<List<Attachment>> ReconcileAsync(List<Attachment> rows)
        {
            if (rows.Count == 0 || !Directory.Exists(_storage.Root)) return rows;
            var deadIds = rows
                .Where(a => _storage.ResolveExisting(a.StoragePath) == null)
                .Select(a => a.Id)
                .ToList();
            if (deadIds.Count == 0) return rows;
            await _repository.DeleteByIdsAsync(deadIds);
            _logger.LogInformation("Pruned {Count} attachment row(s) whose files were missing on disk.", deadIds.Count);
            var dead = new HashSet<int>(deadIds);
            return rows.Where(a => !dead.Contains(a.Id)).ToList();
        }

        public async Task<AttachmentDto?> GetByIdAsync(int id)
        {
            var a = await _repository.GetByIdAsync(id);
            return a == null ? null : AttachmentMapper.ToDto(a);
        }

        public async Task<AttachmentDownload?> GetForDownloadAsync(int id)
        {
            var a = await _repository.GetByIdAsync(id);
            if (a == null) return null;
            var abs = _storage.ResolveExisting(a.StoragePath);
            if (abs == null) return null;
            var contentType = string.IsNullOrWhiteSpace(a.ContentType) ? "application/octet-stream" : a.ContentType;
            return new AttachmentDownload(a.CompanyId, abs, contentType, a.FileName);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var a = await _repository.GetByIdAsync(id);
            if (a == null) return false;
            var path = a.StoragePath;
            await _repository.DeleteAsync(a);
            _storage.TryDelete(path);
            return true;
        }

        /// <summary>Strip any path components and cap length — defense against crafted filenames.</summary>
        private static string SanitizeFileName(string? name)
        {
            var n = Path.GetFileName(name ?? "").Trim();
            if (string.IsNullOrWhiteSpace(n)) n = "file";
            return n.Length > 255 ? n[^255..] : n;
        }
    }
}
