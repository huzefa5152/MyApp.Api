using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Entity → DTO projection for attachments, shared by FolderService (folder
    /// detail) and AttachmentService so the wire shape stays identical wherever
    /// an attachment surfaces. Never includes the on-disk StoragePath.
    /// </summary>
    public static class AttachmentMapper
    {
        public static AttachmentDto ToDto(Attachment a) => new()
        {
            Id = a.Id,
            CompanyId = a.CompanyId,
            DivisionId = a.DivisionId,
            FolderId = a.FolderId,
            FolderName = a.Folder?.Name,
            EntityType = a.EntityType,
            EntityId = a.EntityId,
            FileName = a.FileName,
            FileExtension = a.FileExtension,
            ContentType = a.ContentType,
            FileSizeBytes = a.FileSizeBytes,
            UploadedByUserId = a.UploadedByUserId,
            UploadedByName = a.UploadedByUser?.FullName,
            CreatedAt = a.CreatedAt
        };
    }
}
