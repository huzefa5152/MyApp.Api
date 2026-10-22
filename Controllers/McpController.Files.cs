using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Attachments and print designs through MCP (parity phase 5). Each tool asserts the permission,
    /// the company and the stored company (and division) of the attachment, folder or design it
    /// names, then runs the screen's own action; print HTML is cleaned on save by the screen's path.
    /// </summary>
    public partial class McpController
    {
        private void AddFileTools(List<Tool> t)
        {
            t.AddRange(new Tool[]
            {
                new("search_attachments", "Files attached to a document (entityType + entityId, e.g. Invoice 12) or filed in a folder (folderId), or the uncategorized ones.",
                    Obj(new { companyId = CompanyProp, entityType = Str(40), entityId = Int(), folderId = Int() }, "companyId"), Read: SearchAttachmentsAsync),
                new("get_attachment", "Download one attachment (base64, up to 4 MB).", Obj(new { companyId = CompanyProp, attachmentId = Int() }, "companyId", "attachmentId"), Read: GetAttachmentAsync),
                new("prepare_attachment", "Prepare attaching a file (base64, up to 4 MB) to a document or folder of this company, or deleting an attachment (action 'delete').",
                    Obj(new { companyId = CompanyProp, action = new { type = "string", @enum = new[] { "upload", "delete" } }, attachmentId = Int(), fileName = Str(200), contentType = Str(100),
                        contentBase64 = new { type = "string", maxLength = 5_600_000 }, entityType = Str(40), entityId = Int(), folderId = Int(), idempotencyKey = IdemProp }, "companyId", "action"),
                    Build: BuildAttachmentAsync, PerHour: 30, Noun: "attachment changes"),
                new("prepare_print_template", "Prepare a print design: action 'create' (templateType, name, htmlContent), 'update' (templateId, name, htmlContent), 'default' (make it the default for its type) or 'delete'. Scripts are stripped on save, as on the editor.",
                    Obj(new { companyId = CompanyProp, action = new { type = "string", @enum = new[] { "create", "update", "default", "delete" } }, templateId = Int(), templateType = Str(40), name = Str(200),
                        htmlContent = new { type = "string", maxLength = 500_000 }, divisionId = DivisionProp, isDefault = new { type = "boolean" }, idempotencyKey = IdemProp }, "companyId", "action"),
                    Build: BuildPrintTemplateAsync, PerHour: 20, Noun: "print design changes"),
            });
        }

        // ── attachments ────────────────────────────────────────────────────

        private const int MaxAttachmentBytes = 4 * 1024 * 1024;

        private async Task<object> SearchAttachmentsAsync(JsonElement args)
        {
            await Need("attachments.list.view");
            var companyId = await CompanyArg(args);
            var att = Screen<AttachmentsController>();
            if (OptId(args, "folderId") is int folder) return await ScreenAsync(() => att.GetByFolder(companyId, folder));
            if (OptText(args, "entityType", 40) is { Length: > 0 } type) return await ScreenAsync(() => att.GetByEntity(companyId, type, IdArg(args, "entityId")));
            return await ScreenAsync(() => att.GetUncategorized(companyId));
        }

        private async Task<AttachmentDto> OwnAttachmentAsync(int companyId, int id)
        {
            var meta = await Svc<IAttachmentService>().GetByIdAsync(id);
            if (meta == null || meta.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, meta.DivisionId);
            return meta;
        }

        private async Task<object> GetAttachmentAsync(JsonElement args)
        {
            await Need("attachments.list.view");
            var companyId = await CompanyArg(args);
            var meta = await OwnAttachmentAsync(companyId, IdArg(args, "attachmentId"));
            if (meta.FileSizeBytes > MaxAttachmentBytes) throw new ToolError("The file is larger than 4 MB; download it from the screen.");
            var dl = await Svc<IAttachmentService>().GetForDownloadAsync(meta.Id) ?? throw new ToolError("The file is missing on disk.");
            return new { meta.Id, meta.FileName, meta.ContentType, meta.FileSizeBytes, contentBase64 = Convert.ToBase64String(await System.IO.File.ReadAllBytesAsync(dl.AbsolutePath)) };
        }

        private async Task<Built> BuildAttachmentAsync(int companyId, JsonElement args)
        {
            var action = OptText(args, "action", 10);
            if (action == "delete")
            {
                await Need("attachments.manage.delete");
                var meta = await OwnAttachmentAsync(companyId, IdArg(args, "attachmentId"));
                return new Built(new { action, meta.Id, meta.FileName }, $"Delete attachment \"{meta.FileName}\" in company {companyId}",
                    async () => { await ScreenAsync(() => Screen<AttachmentsController>().Delete(meta.Id)); return ($"Attachment:{meta.Id}", $"Deleted attachment \"{meta.FileName}\""); });
            }
            if (action != "upload") throw new ToolError("action must be upload or delete.");
            await Need("attachments.manage.upload");
            var fileName = OptText(args, "fileName", 200) is { Length: > 0 } fn ? Path.GetFileName(fn) : throw new ToolError("fileName is required.");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(args.TryGetProperty("contentBase64", out var c) ? c.GetString() ?? "" : ""); }
            catch (FormatException) { throw new ToolError("contentBase64 is not valid base64."); }
            if (bytes.Length is 0 or > MaxAttachmentBytes) throw new ToolError("The file must be 1 byte to 4 MB.");
            var entityType = OptText(args, "entityType", 40) is { Length: > 0 } et ? et : null;
            var entityId = OptId(args, "entityId");
            var folderId = OptId(args, "folderId");
            if (folderId is int f && !await _context.Folders.AsNoTracking().AnyAsync(x => x.Id == f && x.CompanyId == companyId)) throw new ToolError(Denied);
            if (entityType != null)
            {
                // The service checks this too at commit; refuse at prepare so no plan names another company's document.
                var kind = AttachmentEntityTypes.Canonical(entityType) switch
                {
                    AttachmentEntityTypes.SalesQuote => "quote", AttachmentEntityTypes.SalesOrder => "sales_order", AttachmentEntityTypes.DeliveryChallan => "challan",
                    AttachmentEntityTypes.Invoice => "bill", AttachmentEntityTypes.PurchaseBill => "purchase_bill", AttachmentEntityTypes.GoodsReceipt => "goods_receipt",
                    AttachmentEntityTypes.WithholdingTaxReceipt => "withholding_receipt", _ => null,
                };
                var eid = entityId ?? throw new ToolError("entityId is required with entityType.");
                int? owner = kind != null ? (await OwnerAsync(kind, eid))?.CompanyId
                    : AttachmentEntityTypes.Canonical(entityType) == AttachmentEntityTypes.Payment ? await _context.Payments.AsNoTracking().Where(x => x.Id == eid).Select(x => (int?)x.CompanyId).FirstOrDefaultAsync()
                    : AttachmentEntityTypes.Canonical(entityType) == AttachmentEntityTypes.AccountTransfer ? await _context.AccountTransfers.AsNoTracking().Where(x => x.Id == eid).Select(x => (int?)x.CompanyId).FirstOrDefaultAsync()
                    : throw new ToolError("That entityType cannot hold attachments.");
                if (owner != companyId) throw new ToolError(Denied);
            }
            var contentType = OptText(args, "contentType", 100) is { Length: > 0 } ct ? ct : "application/octet-stream";
            var hash = Convert.ToHexString(SHA256.HashData(bytes))[..16];
            return new Built(new { action, fileName, contentType, size = bytes.Length, sha256Prefix = hash, entityType, entityId, folderId }, $"Attach \"{fileName}\" ({bytes.Length} bytes) in company {companyId}",
                async () =>
                {
                    await using var stream = new MemoryStream(bytes);
                    var file = new FormFile(stream, 0, bytes.Length, "file", fileName) { Headers = new HeaderDictionary(), ContentType = contentType };
                    var a = As<AttachmentDto>(await ScreenAsync(() => Screen<AttachmentsController>().Upload(companyId, file, folderId, entityType, entityId)));
                    return ($"Attachment:{a.Id}", $"Attached \"{a.FileName}\" (id {a.Id})");
                });
        }

        // ── print templates ────────────────────────────────────────────────

        private static readonly System.Text.RegularExpressions.Regex ActiveHtml = new(
            @"<\s*(script|iframe|frame|object|embed|applet|base|meta|link)\b|\son[a-z]+\s*=|javascript\s*:|vbscript\s*:|srcdoc\s*=|data\s*:\s*text/html",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Compiled);

        private async Task<Built> BuildPrintTemplateAsync(int companyId, JsonElement args)
        {
            await Need("printtemplates.manage.update");
            var action = OptText(args, "action", 10);
            var templates = Screen<PrintTemplatesController>();
            string Html()
            {
                var html = args.TryGetProperty("htmlContent", out var h) && h.ValueKind == JsonValueKind.String && h.GetString()!.Length > 0 ? h.GetString()! : throw new ToolError("htmlContent is required.");
                // Designs print in a same-origin window and this line has no script stripping or print
                // CSP, so an agent may not write active content into one at all.
                if (ActiveHtml.IsMatch(html)) throw new ToolError("Print designs written by an AI may not contain scripts, event handlers, javascript: links, frames or embedded objects.");
                return html;
            }
            if (action == "create")
            {
                var division = OptId(args, "divisionId");
                if (division != null) await AssertDivisionWriteAsync(companyId, division);
                var dto = new CreatePrintTemplateDto
                {
                    TemplateType = OptText(args, "templateType", 40) ?? throw new ToolError("templateType is required."), DivisionId = division,
                    Name = OptText(args, "name", 200) ?? throw new ToolError("name is required."), HtmlContent = Html(), IsDefault = OptBool(args, "isDefault") ?? false,
                };
                return new Built(new { action, dto.TemplateType, dto.Name, dto.DivisionId, dto.IsDefault, htmlLength = dto.HtmlContent.Length }, $"Create print design \"{dto.Name}\" ({dto.TemplateType}) in company {companyId}",
                    async () => { var r = await ScreenAsync(() => templates.Create(companyId, dto)); var el = JsonSerializer.SerializeToElement(r); return ($"PrintTemplate:{(el.TryGetProperty("id", out var i) ? i.GetInt32() : 0)}", $"Created print design \"{dto.Name}\""); });
            }
            var id = IdArg(args, "templateId");
            var stored = await _context.PrintTemplates.AsNoTracking().Where(p => p.Id == id).Select(p => new { p.CompanyId, p.Name, p.DivisionId }).FirstOrDefaultAsync();
            if (stored == null || stored.CompanyId != companyId) throw new ToolError(Denied);
            if (stored.DivisionId != null) await AssertDivisionWriteAsync(companyId, stored.DivisionId);
            switch (action)
            {
                case "update":
                    var udto = new UpdatePrintTemplateDto { Name = OptText(args, "name", 200) ?? stored.Name, HtmlContent = Html() };
                    return new Built(new { action, templateId = id, udto.Name, htmlLength = udto.HtmlContent.Length }, $"Update print design \"{stored.Name}\" in company {companyId}",
                        async () => { await ScreenAsync(() => templates.Update(id, udto)); return ($"PrintTemplate:{id}", $"Updated print design \"{udto.Name}\""); });
                case "default":
                    return new Built(new { action, templateId = id, stored.Name }, $"Make \"{stored.Name}\" the default print design in company {companyId}",
                        async () => { await ScreenAsync(() => templates.SetDefault(id)); return ($"PrintTemplate:{id}", $"\"{stored.Name}\" is now the default"); });
                case "delete":
                    await Need("printtemplates.manage.delete");
                    return new Built(new { action, templateId = id, stored.Name }, $"Delete print design \"{stored.Name}\" in company {companyId}",
                        async () => { await ScreenAsync(() => templates.Delete(id)); return ($"PrintTemplate:{id}", $"Deleted print design \"{stored.Name}\""); });
                default: throw new ToolError("action must be create, update, default or delete.");
            }
        }
    }
}
