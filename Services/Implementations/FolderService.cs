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
    /// Document folders — per-company named containers for attachments. Names
    /// are unique within a company. Deleting a folder is transactional (see
    /// <see cref="DeleteAsync"/>) and must not orphan entity-linked files.
    /// </summary>
    public class FolderService : IFolderService
    {
        private readonly IFolderRepository _repository;
        private readonly IAttachmentService _attachmentService;
        private readonly AttachmentStorage _storage;
        private readonly AppDbContext _context;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly ILogger<FolderService> _logger;

        public FolderService(
            IFolderRepository repository,
            IAttachmentService attachmentService,
            AttachmentStorage storage,
            AppDbContext context,
            IDivisionAccessGuard divisionAccess,
            ILogger<FolderService> logger)
        {
            _repository = repository;
            _attachmentService = attachmentService;
            _storage = storage;
            _context = context;
            _divisionAccess = divisionAccess;
            _logger = logger;
        }

        private static FolderDto ToDto(Folder f, int attachmentCount) => new()
        {
            Id = f.Id,
            CompanyId = f.CompanyId,
            Name = f.Name,
            Description = f.Description,
            CreatedByUserId = f.CreatedByUserId,
            CreatedByName = f.CreatedByUser?.FullName,
            CreatedAt = f.CreatedAt,
            AttachmentCount = attachmentCount
        };

        public async Task<List<FolderDto>> GetByCompanyAsync(int companyId)
        {
            // Dropdown source for the attachment component — only names are shown
            // there, so skip the disk-reconciling count pass to keep it cheap.
            var folders = await _repository.GetByCompanyAsync(companyId);
            return folders.Select(f => ToDto(f, 0)).ToList();
        }

        public async Task<PagedResult<FolderDto>> GetPagedByCompanyAsync(int companyId, int page, int pageSize, string? search = null)
        {
            var (items, totalCount) = await _repository.GetPagedByCompanyAsync(companyId, page, pageSize, search);
            // Disk-reconciled counts so the list badges reflect manual file deletions.
            var counts = await _attachmentService.GetCountsByFolderAsync(companyId, items.Select(f => f.Id));
            return new PagedResult<FolderDto>
            {
                Items = items.Select(f => ToDto(f, counts.GetValueOrDefault(f.Id))).ToList(),
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize
            };
        }

        public async Task<FolderDto?> GetByIdAsync(int id, int? userIdForDivisionScope = null)
        {
            var f = await _repository.GetByIdWithCreatorAsync(id);
            if (f == null) return null;
            // Division-restricted callers only see their divisions' attachments
            // in the folder detail (the scope resolution is cached in the guard).
            var divScope = userIdForDivisionScope.HasValue
                ? await _divisionAccess.GetAccessibleDivisionIdsAsync(userIdForDivisionScope.Value, f.CompanyId)
                : null;
            // Attachments come back disk-reconciled (manually-deleted files pruned).
            var attachments = await _attachmentService.GetByFolderAsync(f.CompanyId, f.Id, divScope);
            var dto = ToDto(f, attachments.Count);
            dto.Attachments = attachments;
            return dto;
        }

        public async Task<FolderDto> CreateAsync(int companyId, CreateFolderDto dto, int userId)
        {
            var name = (dto.Name ?? "").Trim();
            if (string.IsNullOrWhiteSpace(name))
                throw new InvalidOperationException("Folder name is required.");
            if (name.Length > 200)
                throw new InvalidOperationException("Folder name must be 200 characters or fewer.");
            if (await _repository.NameExistsAsync(companyId, name))
                throw new InvalidOperationException($"A folder named \"{name}\" already exists.");

            var folder = new Folder
            {
                CompanyId = companyId,
                Name = name,
                Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim(),
                CreatedByUserId = userId > 0 ? userId : null
            };
            await _repository.AddAsync(folder);
            return ToDto(folder, 0);
        }

        public async Task<FolderDto?> UpdateAsync(int id, CreateFolderDto dto)
        {
            var folder = await _repository.GetByIdAsync(id);
            if (folder == null) return null;

            var name = (dto.Name ?? "").Trim();
            if (string.IsNullOrWhiteSpace(name))
                throw new InvalidOperationException("Folder name is required.");
            if (name.Length > 200)
                throw new InvalidOperationException("Folder name must be 200 characters or fewer.");
            if (await _repository.NameExistsAsync(folder.CompanyId, name, excludeId: id))
                throw new InvalidOperationException($"A folder named \"{name}\" already exists.");

            folder.Name = name;
            folder.Description = string.IsNullOrWhiteSpace(dto.Description) ? null : dto.Description.Trim();
            await _repository.UpdateAsync(folder);
            return await GetByIdAsync(id);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            // Load tracked, with attachments, so we can decide each file's fate.
            var folder = await _context.Folders
                .Include(f => f.Attachments)
                .FirstOrDefaultAsync(f => f.Id == id);
            if (folder == null) return false;

            // Collect on-disk paths to remove only AFTER the DB commit succeeds.
            var toDeleteFromDisk = new List<string>();

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                foreach (var att in folder.Attachments.ToList())
                {
                    var entityLinked = !string.IsNullOrWhiteSpace(att.EntityType) && att.EntityId.HasValue;
                    if (entityLinked)
                    {
                        // Keep the file + row; just un-categorize it so the
                        // owning Sales Quote / Invoice / etc. still has it.
                        att.FolderId = null;
                    }
                    else
                    {
                        toDeleteFromDisk.Add(att.StoragePath);
                        _context.Attachments.Remove(att);
                    }
                }
                _context.Folders.Remove(folder);
                await _context.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            // Best-effort file cleanup — the DB rows are already gone.
            foreach (var path in toDeleteFromDisk)
                _storage.TryDelete(path);
            return true;
        }
    }
}
