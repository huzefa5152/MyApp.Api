using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;

namespace MyApp.Api.Services.Implementations;

public sealed partial class EmailWorkspaceService
{
    private async Task AssertAssistanceAsync(int user, int company, int id, Guid? revision, CancellationToken ct)
    {
        await MessageAsync(user, company, id, ct);
        if (!await permissions.HasPermissionAsync(user, "email.enquiries.manage")) throw new UnauthorizedAccessException();
        var enquiry = await db.EmailEnquiries.AsNoTracking().SingleOrDefaultAsync(e => e.CompanyId == company && e.MessageId == id, ct);
        if (enquiry == null || enquiry.Decision != "Kept" || enquiry.SalesQuoteId != null || enquiry.ProtectedDraft.Length == 0)
            throw Invalid("Prepare a kept, unconverted enquiry first.");
        AssertRevision(enquiry, revision);
    }
    public async Task<EmailAttachmentPreview> PreviewAttachmentAsync(int user, int company, int id, EmailAttachmentRequest request, CancellationToken ct)
    {
        await AssertAssistanceAsync(user, company, id, request.Revision, ct);
        var message = await MessageAsync(user, company, id, ct);
        var info = Unprotect<EmailContent>(message.ProtectedContent).Attachments.SingleOrDefault(a => a.Id == request.AttachmentId) ?? throw Missing();
        try
        {
            var file = await AttachmentAsync(user, company, id, request.AttachmentId, ct);
            var preview = EmailAttachmentReader.Read(message.Subject, info, file.Bytes);
            if (request.Pages == null)
            {
                access.InvalidateUser(user); permissions.InvalidateUser(user);
                await AssertAssistanceAsync(user, company, id, request.Revision, ct);
                return preview;
            }
            if (!preview.RequiresOcr && !info.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) throw Invalid("OCR is available for images and PDFs only.");
            if (request.Pages.Count is < 1 or > 10 || request.Pages.Sum(p => p?.Count ?? 0) > 15_000) throw Invalid("OCR supports up to 10 pages and 15,000 words.");
            foreach (var page in request.Pages)
                if (page == null || page.Count > 3000 || page.Any(w => w == null || w.Text == null || w.Text.Length > 200
                    || !double.IsFinite(w.Left) || !double.IsFinite(w.Right) || !double.IsFinite(w.Top) || !double.IsFinite(w.Bottom)
                    || !double.IsFinite(w.Confidence) || w.Confidence is < 0 or > 100
                    || w.Left < 0 || w.Top < 0 || w.Right < w.Left || w.Bottom < w.Top || w.Right > 100_000 || w.Bottom > 100_000))
                    throw Invalid("OCR contains invalid word positions.");
            var text = string.Join('\n', request.Pages.SelectMany(p => PoLayoutText.FromOcrPage(p.Select(w => new PositionedWord(
                w.Text, w.Left, w.Right, w.Top, w.Bottom, w.Right - w.Left, w.Bottom - w.Top, w.Confidence)).ToList())));
            var extracted = EmailAttachmentReader.FromText(message.Subject, text);
            access.InvalidateUser(user); permissions.InvalidateUser(user);
            await AssertAssistanceAsync(user, company, id, request.Revision, ct);
            return new(info.FileName, text, extracted.Items,
                extracted.Warnings.Append("OCR can misread digits and specifications. Check the original attachment before applying.").ToList(),
                false, extracted.RequiresBrand, extracted.RequiresSpecifications);
        }
        catch (EmailWorkspaceException) { throw; }
        catch (UnauthorizedAccessException) { throw; }
        catch (OperationCanceledException) { throw; }
        catch (Exception) { throw Invalid("The attachment could not be read. Check its format and limits, or enter the items manually."); }
    }
    public async Task<EmailDraftDto> ApplyAttachmentAsync(int user, int company, int id, EmailAttachmentRequest request, CancellationToken ct)
    {
        if (request.Mode is not ("Append" or "Replace")) throw Invalid("Choose Append or Replace.");
        var preview = await PreviewAttachmentAsync(user, company, id, request, ct);
        if (preview.RequiresOcr || preview.Items.Count == 0) throw Invalid("Read the attachment and confirm that items were found first.");
        access.InvalidateUser(user); permissions.InvalidateUser(user);
        await AssertAssistanceAsync(user, company, id, request.Revision, ct);
        var enquiry = await db.EmailEnquiries.SingleAsync(e => e.CompanyId == company && e.MessageId == id, ct);
        AssertRevision(enquiry, request.Revision);
        var draft = Unprotect<EmailDraftDto>(enquiry.ProtectedDraft);
        var items = request.Mode == "Replace" ? preview.Items : draft.Items.Concat(preview.Items).ToList();
        if (items.Count > 200) throw Invalid("The combined draft exceeds 200 items. Split the enquiry or replace existing items.");
        draft.Items = items; draft.Reviewed = false;
        draft.RequiresBrand |= preview.RequiresBrand; draft.RequiresSpecifications |= preview.RequiresSpecifications;
        if (preview.RequiresSpecifications) draft.SpecificationsConfirmed = false;
        draft.Warnings = draft.Warnings.Concat(preview.Warnings).Append("Imported attachment: " + preview.FileName).Distinct().Take(100).ToList();
        enquiry.Revision = Guid.NewGuid(); draft.Revision = enquiry.Revision; enquiry.ProtectedDraft = Protect(draft); enquiry.UpdatedAt = DateTime.UtcNow;
        Event(user, company, "AttachmentItemsApplied", enquiry.Id); await db.SaveChangesAsync(ct);
        return draft;
    }
    public async Task<List<EmailItemAssistance>> AssistItemsAsync(int user, int company, int id, EmailAssistanceRequest request, CancellationToken ct)
    {
        await AssertAssistanceAsync(user, company, id, request.Revision, ct);
        if (request.Items.Count is < 1 or > 200) throw Invalid("Use between 1 and 200 items.");
        if (request.Items.Any(i => i == null || i.Description == null || i.Unit == null || i.Description.Length > 2000 || i.Unit.Length > 100)) throw Invalid("An item contains invalid description or unit data.");
        if (request.ClientId.HasValue && !await db.Clients.AnyAsync(c => c.Id == request.ClientId && c.CompanyId == company, ct)) throw Invalid("Customer must belong to this company.");
        var canQuotes = await permissions.HasPermissionAsync(user, "salesquotes.list.view");
        var canPurchases = await permissions.HasPermissionAsync(user, "purchasebills.list.view");
        var catalogue = await db.ItemDescriptions.AsNoTracking().Where(d => d.CompanyId == company)
            .OrderByDescending(d => d.IsFavorite).ThenBy(d => d.Name).Take(2000).Select(d => new { d.Name, Unit = d.UOM ?? "" }).ToListAsync(ct);
        var quotesHistory = canQuotes && request.ClientId.HasValue
            ? await db.SalesQuoteItems.AsNoTracking().Where(i => i.SalesQuote.CompanyId == company && i.SalesQuote.ClientId == request.ClientId)
                .OrderByDescending(i => i.SalesQuote.Date).ThenByDescending(i => i.Id).Take(2000)
                .Select(i => new { i.Description, i.Unit, i.UnitPrice, i.SalesQuote.Date, Number = i.SalesQuote.QuoteNumber }).ToListAsync(ct) : [];
        var purchaseHistory = canPurchases
            ? await db.PurchaseItems.AsNoTracking().Where(i => i.PurchaseBill.CompanyId == company)
                .OrderByDescending(i => i.PurchaseBill.Date).ThenByDescending(i => i.Id).Take(2000)
                .Select(i => new { i.Description, Unit = i.UOM, i.UnitPrice, i.PurchaseBill.Date, Number = i.PurchaseBill.PurchaseBillNumber }).ToListAsync(ct) : [];
        var learned = new List<EmailDraftItem>();
        if (canQuotes && request.ClientId.HasValue)
        {
            var confirmed = await db.EmailEnquiries.AsNoTracking().Where(e => e.CompanyId == company && e.SalesQuoteId != null)
                .OrderByDescending(e => e.UpdatedAt).Take(200).Select(e => e.ProtectedDraft).ToListAsync(ct);
            foreach (var encrypted in confirmed)
            {
                try
                {
                    var past = Unprotect<EmailDraftDto>(encrypted);
                    if (past.ClientId == request.ClientId && past.Reviewed) learned.AddRange(past.Items.Where(i => !string.IsNullOrWhiteSpace(i.SourceDescription)));
                }
                catch (Exception ex) when (ex is CryptographicException or JsonException) { }
            }
        }
        var candidates = catalogue.Select(c => (Description: c.Name, c.Unit))
            .Concat(quotesHistory.Where(q => !q.Description.Contains("\nBrand / make:")).Select(q => (q.Description, q.Unit))).Distinct().ToList();
        var quotePrices = quotesHistory.ToLookup(q => (EmailItemMatching.Normalize(q.Description), EmailItemMatching.Normalize(q.Unit)));
        var purchasePrices = purchaseHistory.ToLookup(p => (EmailItemMatching.Normalize(p.Description), EmailItemMatching.Normalize(p.Unit)));
        var result = new List<EmailItemAssistance>();
        foreach (var (item, index) in request.Items.Select((item, index) => (item, index)))
        {
            ct.ThrowIfCancellationRequested();
            var remembered = learned.Where(p => EmailItemMatching.Normalize(p.SourceDescription!) == EmailItemMatching.Normalize(item.SourceDescription ?? item.Description)
                && EmailItemMatching.Normalize(p.Unit) == EmailItemMatching.Normalize(item.Unit)
                && EmailItemMatching.Normalize(p.Brand) == EmailItemMatching.Normalize(item.Brand)).Select(p => p.Description).ToHashSet();
            var ranked = candidates.Select(c => new { c.Description, c.Unit, Learned = remembered.Contains(c.Description), Score = EmailItemMatching.Score(item.Description, c.Description) })
                .Where(c => (c.Score >= 60 || c.Learned) && (string.IsNullOrWhiteSpace(c.Unit) || string.IsNullOrWhiteSpace(item.Unit) || EmailItemMatching.Normalize(c.Unit) == EmailItemMatching.Normalize(item.Unit)))
                .OrderByDescending(c => c.Learned).ThenByDescending(c => c.Score).ThenBy(c => c.Description).Take(3).ToList();
            // Exact current text also gives prices when the catalogue has no entry yet.
            var output = new List<EmailItemCandidate>();
            foreach (var c in ranked.Select(c => (c.Description, Unit: string.IsNullOrWhiteSpace(c.Unit) ? item.Unit : c.Unit, c.Score, c.Learned))
                .Prepend((Description: item.Description, Unit: item.Unit, Score: 100, Learned: false)).DistinctBy(c => (EmailItemMatching.Normalize(c.Description), EmailItemMatching.Normalize(c.Unit))))
            {
                var pricedDescription = string.IsNullOrWhiteSpace(item.Brand) ? c.Description : c.Description + "\nBrand / make: " + item.Brand.Trim();
                var key = (EmailItemMatching.Normalize(pricedDescription), EmailItemMatching.Normalize(c.Unit));
                var quote = quotePrices[key].FirstOrDefault();
                var purchase = purchasePrices[key].FirstOrDefault();
                if (quote == null && purchase == null && !ranked.Any(r => r.Description == c.Description)) continue;
                output.Add(new(c.Description, c.Unit, c.Score, c.Learned ? "Previously approved for this customer" : c.Score == 100 ? "Exact description" : "Similar catalogue description — check specifications",
                    quote == null ? null : new(quote.UnitPrice, quote.Date, quote.Number), purchase == null ? null : new(purchase.UnitPrice, purchase.Date, purchase.Number)));
            }
            result.Add(new(index, output.Take(4).ToList()));
        }
        access.InvalidateUser(user); permissions.InvalidateUser(user);
        await AssertAssistanceAsync(user, company, id, request.Revision, ct);
        if (canQuotes && !await permissions.HasPermissionAsync(user, "salesquotes.list.view") || canPurchases && !await permissions.HasPermissionAsync(user, "purchasebills.list.view"))
            throw new UnauthorizedAccessException();
        return result;
    }
}
