using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Customer Portal. See <see cref="ICustomerPortalService"/> for the contract
    /// and <see cref="CustomerPortal"/> for the security model.
    ///
    /// Two rules govern everything in this file:
    ///
    ///  1. TENANT SCOPE IS STRUCTURAL. Every public read starts from
    ///     <see cref="VisibleInvoices"/>, which filters on the resolved portal's
    ///     CompanyId AND ClientId. No public method takes a company or client id
    ///     as an argument, so there is nothing for a caller to tamper with. The
    ///     usual ICompanyAccessGuard is unusable here — it is user-based, and
    ///     grants everything to the seed admin id.
    ///
    ///  2. NOTHING IS RECALCULATED. Money and payment state come from
    ///     <see cref="WithholdingTaxCalculator.Collectible"/> and
    ///     <see cref="PaymentStatusCalculator"/>, the same two helpers the
    ///     internal invoice list uses. The one concession is the STATUS FILTER,
    ///     which has to run in SQL to page correctly — see
    ///     <see cref="ApplyStatusFilter"/> for why, and what pins it honest.
    /// </summary>
    public class CustomerPortalService : ICustomerPortalService
    {
        private readonly AppDbContext _context;
        private readonly IInvoiceService _invoices;
        private readonly ILogger<CustomerPortalService> _logger;

        public CustomerPortalService(
            AppDbContext context,
            IInvoiceService invoices,
            ILogger<CustomerPortalService> logger)
        {
            _context = context;
            _invoices = invoices;
            _logger = logger;
        }

        /// <summary>The only two documents a portal can serve, and their labels.</summary>
        private static readonly Dictionary<string, string> DocumentTypes = new(StringComparer.Ordinal)
        {
            ["Bill"] = "Bill",
            ["TaxInvoice"] = "Tax Invoice",
        };

        /// <summary>
        /// Canonicalises the operator's choice. Null/blank means "choose
        /// automatically" — the pre-existing behaviour that legacy portals keep.
        /// Anything else must be one of the two known types; a typo becomes an
        /// error rather than a portal that silently prints nothing.
        /// </summary>
        private static string? NormaliseDocumentType(string? documentType)
        {
            if (string.IsNullOrWhiteSpace(documentType)) return null;
            var trimmed = documentType.Trim();
            foreach (var key in DocumentTypes.Keys)
                if (string.Equals(key, trimmed, StringComparison.OrdinalIgnoreCase))
                    return key;
            throw new InvalidOperationException("Choose either the Bill or the Tax Invoice document.");
        }

        private static string LabelFor(string? documentType) =>
            documentType != null && DocumentTypes.TryGetValue(documentType, out var l) ? l : "Automatic";

        // ── Management ───────────────────────────────────────────────────────

        public async Task<List<CustomerPortalDto>> GetAllAsync(
            IReadOnlyCollection<int> allowedCompanyIds, Func<string, string> urlBuilder)
        {
            var rows = await _context.CustomerPortals.AsNoTracking()
                .Where(p => allowedCompanyIds.Contains(p.CompanyId))
                .OrderByDescending(p => p.CreatedAt)
                .Select(p => new
                {
                    p.Id, p.CompanyId, p.ClientId, p.PublicToken, p.IsActive,
                    p.DocumentType, p.CreatedAt, p.DisabledAt,
                    CompanyName = p.Company.Name,
                    ClientName = p.Client.Name,
                })
                .ToListAsync();

            // One query for every company in the list rather than one per row —
            // the screen shows a warning when the chosen document has no template.
            var companyIds = rows.Select(r => r.CompanyId).Distinct().ToList();
            var templates = await _context.PrintTemplates.AsNoTracking()
                .Where(t => companyIds.Contains(t.CompanyId)
                         && (t.TemplateType == "Bill" || t.TemplateType == "TaxInvoice"))
                .Select(t => new { t.CompanyId, t.TemplateType })
                .Distinct()
                .ToListAsync();
            var available = templates
                .GroupBy(t => t.CompanyId)
                .ToDictionary(g => g.Key, g => g.Select(x => x.TemplateType).ToHashSet(StringComparer.Ordinal));

            return rows.Select(r =>
            {
                var have = available.TryGetValue(r.CompanyId, out var set) ? set : new HashSet<string>(StringComparer.Ordinal);
                return new CustomerPortalDto
                {
                    Id = r.Id,
                    CompanyId = r.CompanyId,
                    CompanyName = r.CompanyName,
                    ClientId = r.ClientId,
                    ClientName = r.ClientName,
                    PublicUrl = urlBuilder(r.PublicToken),
                    IsActive = r.IsActive,
                    DocumentType = r.DocumentType,
                    DocumentTypeLabel = LabelFor(r.DocumentType),
                    TemplateAvailable = r.DocumentType == null ? have.Count > 0 : have.Contains(r.DocumentType),
                    AvailableDocumentTypes = have.OrderBy(x => x).ToList(),
                    CreatedAt = r.CreatedAt,
                    DisabledAt = r.DisabledAt,
                };
            }).ToList();
        }

        public async Task<CustomerPortalDto?> GetByIdAsync(int id, Func<string, string> urlBuilder)
        {
            var p = await _context.CustomerPortals.AsNoTracking()
                .Include(x => x.Company).Include(x => x.Client)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (p == null) return null;

            var dto = ToDto(p, urlBuilder);
            var have = await _context.PrintTemplates.AsNoTracking()
                .Where(t => t.CompanyId == p.CompanyId
                         && (t.TemplateType == "Bill" || t.TemplateType == "TaxInvoice"))
                .Select(t => t.TemplateType).Distinct().ToListAsync();
            dto.AvailableDocumentTypes = have.OrderBy(x => x).ToList();
            dto.TemplateAvailable = p.DocumentType == null ? have.Count > 0 : have.Contains(p.DocumentType);
            return dto;
        }

        public async Task<CustomerPortalDto> CreateAsync(
            int companyId, int clientId, string? documentType, int userId, Func<string, string> urlBuilder)
        {
            var chosen = NormaliseDocumentType(documentType);
            var client = await _context.Clients.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == clientId)
                ?? throw new KeyNotFoundException("Client not found.");
            // The client must belong to the company the caller nominated. Without
            // this a forged body could bind a portal to another tenant's client
            // and then serve their invoices under this company's branding.
            if (client.CompanyId != companyId)
                throw new InvalidOperationException("Client does not belong to this company.");

            if (await _context.CustomerPortals.AnyAsync(p =>
                    p.CompanyId == companyId && p.ClientId == clientId && p.IsActive))
                throw new InvalidOperationException(
                    "This client already has an active portal. Disable or revoke it before creating another.");

            var portal = new CustomerPortal
            {
                CompanyId = companyId,
                ClientId = clientId,
                PublicToken = PublicTokenGenerator.Create(),
                IsActive = true,
                DocumentType = chosen,
                CreatedAt = DateTime.UtcNow,
                CreatedByUserId = userId,
            };
            _context.CustomerPortals.Add(portal);
            await _context.SaveChangesAsync();

            // Deliberately logs the portal id, never the token.
            _logger.LogInformation(
                "Customer portal {PortalId} created for company {CompanyId} client {ClientId} by user {UserId}",
                portal.Id, companyId, clientId, userId);

            return (await GetByIdAsync(portal.Id, urlBuilder))!;
        }

        public async Task<CustomerPortalDto?> SetActiveAsync(
            int id, bool isActive, int userId, Func<string, string> urlBuilder)
        {
            var portal = await _context.CustomerPortals.FirstOrDefaultAsync(p => p.Id == id);
            if (portal == null) return null;

            // Re-enabling has to respect the one-live-link rule too, or a second
            // portal issued while this one was off would collide on the filtered
            // unique index — better a clear message than a DbUpdateException.
            if (isActive && !portal.IsActive && await _context.CustomerPortals.AnyAsync(p =>
                    p.CompanyId == portal.CompanyId && p.ClientId == portal.ClientId && p.IsActive && p.Id != id))
                throw new InvalidOperationException(
                    "Another active portal already exists for this client. Disable it first.");

            portal.IsActive = isActive;
            portal.DisabledAt = isActive ? null : DateTime.UtcNow;
            portal.UpdatedAt = DateTime.UtcNow;
            portal.UpdatedByUserId = userId;
            await _context.SaveChangesAsync();

            _logger.LogInformation("Customer portal {PortalId} {State} by user {UserId}",
                id, isActive ? "enabled" : "disabled", userId);

            return await GetByIdAsync(id, urlBuilder);
        }

        public async Task<CustomerPortalDto?> SetDocumentTypeAsync(
            int id, string? documentType, int userId, Func<string, string> urlBuilder)
        {
            var chosen = NormaliseDocumentType(documentType);
            var portal = await _context.CustomerPortals.FirstOrDefaultAsync(p => p.Id == id);
            if (portal == null) return null;

            portal.DocumentType = chosen;
            portal.UpdatedAt = DateTime.UtcNow;
            portal.UpdatedByUserId = userId;
            await _context.SaveChangesAsync();

            _logger.LogInformation("Customer portal {PortalId} document set to {DocumentType} by user {UserId}",
                id, chosen ?? "automatic", userId);
            return await GetByIdAsync(id, urlBuilder);
        }

        public async Task<List<PortalDocumentOptionDto>> GetDocumentOptionsAsync(int companyId)
        {
            var have = await _context.PrintTemplates.AsNoTracking()
                .Where(t => t.CompanyId == companyId
                         && (t.TemplateType == "Bill" || t.TemplateType == "TaxInvoice"))
                .Select(t => t.TemplateType)
                .Distinct()
                .ToListAsync();

            return DocumentTypes.Select(kv => new PortalDocumentOptionDto
            {
                Type = kv.Key,
                Label = kv.Value,
                Available = have.Contains(kv.Key),
            }).ToList();
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var portal = await _context.CustomerPortals.FirstOrDefaultAsync(p => p.Id == id);
            if (portal == null) return false;
            _context.CustomerPortals.Remove(portal);
            await _context.SaveChangesAsync();
            _logger.LogInformation("Customer portal {PortalId} revoked", id);
            return true;
        }

        private static CustomerPortalDto ToDto(CustomerPortal p, Func<string, string> urlBuilder) => new()
        {
            Id = p.Id,
            CompanyId = p.CompanyId,
            CompanyName = p.Company?.Name ?? "",
            ClientId = p.ClientId,
            ClientName = p.Client?.Name ?? "",
            PublicUrl = urlBuilder(p.PublicToken),
            IsActive = p.IsActive,
            DocumentType = p.DocumentType,
            DocumentTypeLabel = LabelFor(p.DocumentType),
            CreatedAt = p.CreatedAt,
            DisabledAt = p.DisabledAt,
        };

        // ── Public ───────────────────────────────────────────────────────────

        public async Task<ResolvedPortal?> ResolveAsync(string token)
        {
            // Shape check first so a junk path segment costs a string scan.
            if (!PublicTokenGenerator.LooksValid(token)) return null;
            return await _context.CustomerPortals.AsNoTracking()
                .Where(p => p.PublicToken == token && p.IsActive)
                .Select(p => new ResolvedPortal(p.Id, p.CompanyId, p.ClientId, p.DocumentType))
                .FirstOrDefaultAsync();
        }

        /// <summary>
        /// THE tenant boundary. Every public read composes from this and nothing
        /// else. Excludes documents a customer has no business seeing:
        /// credit/debit notes (their own numbering and meaning), cancelled and
        /// sandbox-demo rows, and anything the operator flagged out of FBR.
        /// </summary>
        private IQueryable<Invoice> VisibleInvoices(ResolvedPortal portal) =>
            _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == portal.CompanyId
                         && i.ClientId == portal.ClientId
                         && i.NoteKind == 0
                         && !i.IsCancelled
                         && !i.IsDemo
                         && !i.IsFbrExcluded);

        public async Task<PortalHeaderDto?> GetHeaderAsync(ResolvedPortal portal)
        {
            var head = await _context.CustomerPortals.AsNoTracking()
                .Where(p => p.Id == portal.PortalId)
                .Select(p => new
                {
                    CompanyName = p.Company.BrandName ?? p.Company.Name,
                    p.Company.LogoPath,
                    p.Company.FullAddress,
                    p.Company.Phone,
                    p.Company.NTN,
                    p.Company.STRN,
                    ClientName = p.Client.Name,
                })
                .FirstOrDefaultAsync();
            if (head == null) return null;

            // Summary is computed over EVERY visible invoice, not the current
            // page, and in memory through the real calculator rather than a SQL
            // rewrite — the totals are the numbers the customer will argue about,
            // so they must come from the canonical helpers. The projection is
            // three columns wide and scoped to one client, so it stays cheap.
            var rows = await VisibleInvoices(portal)
                .Select(i => new { i.GrandTotal, i.WithholdingTaxAmount, i.AmountPaid, i.DueDate })
                .ToListAsync();

            var summary = new PortalSummaryDto { TotalInvoices = rows.Count };
            foreach (var r in rows)
            {
                var total = WithholdingTaxCalculator.Collectible(r.GrandTotal, r.WithholdingTaxAmount);
                var status = PaymentStatusCalculator.PublicStatus(total, r.AmountPaid, r.DueDate);

                summary.TotalAmount += total;
                summary.PaidAmount += r.AmountPaid;
                summary.OutstandingAmount += PaymentStatusCalculator.BalanceDue(total, r.AmountPaid);
                summary.OverpaidAmount += PaymentStatusCalculator.CreditBalance(total, r.AmountPaid);

                switch (status)
                {
                    case PaymentStatus.Paid: summary.PaidCount++; break;
                    case PaymentStatus.Unpaid: summary.UnpaidCount++; break;
                    case PaymentStatus.PartiallyPaid: summary.PartiallyPaidCount++; break;
                    case PaymentStatus.Overpaid: summary.OverpaidCount++; break;
                    case PaymentStatus.Overdue: summary.OverdueCount++; break;
                }
            }

            // Whether printing is offered at all. A company with no Bill template
            // can't produce a document, and a customer should not meet a button
            // that only ever errors.
            // Follows the portal's own choice: if the operator picked the Tax
            // Invoice and the company only has a Bill template, printing is off —
            // silently substituting the other document would hand the customer a
            // different piece of paper than the one that was configured.
            var chosen = portal.DocumentType;
            var canPrint = await _context.PrintTemplates.AsNoTracking()
                .AnyAsync(t => t.CompanyId == portal.CompanyId
                            && (chosen != null
                                ? t.TemplateType == chosen
                                : t.TemplateType == "Bill" || t.TemplateType == "TaxInvoice"));

            return new PortalHeaderDto
            {
                CompanyName = head.CompanyName ?? "",
                CanPrint = canPrint,
                CompanyLogoPath = head.LogoPath,
                CompanyAddress = head.FullAddress,
                CompanyPhone = head.Phone,
                CompanyNTN = head.NTN,
                CompanySTRN = head.STRN,
                ClientName = head.ClientName,
                Summary = summary,
            };
        }

        public async Task<PagedResult<PortalInvoiceListItemDto>> GetInvoicesAsync(
            ResolvedPortal portal, int page, int pageSize,
            string? status, string? search, DateTime? dateFrom, DateTime? dateTo)
        {
            var q = VisibleInvoices(portal);

            if (dateFrom.HasValue) q = q.Where(i => i.Date >= dateFrom.Value.Date);
            if (dateTo.HasValue) q = q.Where(i => i.Date <= dateTo.Value.Date);

            // Search is restricted to the document number: it is the only field a
            // customer knows to search by, it is indexed, and a free-text LIKE over
            // descriptions on an unauthenticated endpoint is a cheap way to burn
            // the server's CPU.
            if (!string.IsNullOrWhiteSpace(search) && int.TryParse(search.Trim(), out var num))
                q = q.Where(i => i.InvoiceNumber == num);
            else if (!string.IsNullOrWhiteSpace(search))
                q = q.Where(i => false);   // non-numeric search can't match a number

            q = ApplyStatusFilter(q, status);

            var total = await q.CountAsync();
            var rows = await q
                .OrderByDescending(i => i.Date).ThenByDescending(i => i.InvoiceNumber)
                .Skip((page - 1) * pageSize).Take(pageSize)
                .Select(i => new { i.InvoiceNumber, i.Date, i.DueDate, i.GrandTotal, i.WithholdingTaxAmount, i.AmountPaid })
                .ToListAsync();

            return new PagedResult<PortalInvoiceListItemDto>
            {
                Page = page,
                PageSize = pageSize,
                TotalCount = total,
                Items = rows.Select(r =>
                {
                    var t = WithholdingTaxCalculator.Collectible(r.GrandTotal, r.WithholdingTaxAmount);
                    return new PortalInvoiceListItemDto
                    {
                        InvoiceNumber = r.InvoiceNumber,
                        Date = r.Date,
                        DueDate = r.DueDate,
                        Total = t,
                        Paid = r.AmountPaid,
                        Balance = PaymentStatusCalculator.BalanceDue(t, r.AmountPaid),
                        Credit = PaymentStatusCalculator.CreditBalance(t, r.AmountPaid),
                        Status = PaymentStatusCalculator.PublicStatus(t, r.AmountPaid, r.DueDate).ToString(),
                        DaysOverdue = PaymentStatusCalculator.DaysOverdue(t, r.AmountPaid, r.DueDate),
                    };
                }).ToList(),
            };
        }

        /// <summary>
        /// The status filter, expressed in SQL.
        ///
        /// This is the one place the portal restates logic that lives in
        /// <see cref="PaymentStatusCalculator"/>, and it is not a free choice:
        /// status is derived at read time, so filtering it in memory would mean
        /// loading every invoice before paging — exactly what the requirement
        /// forbids. The predicates below are a line-for-line mirror of
        /// <see cref="PaymentStatusCalculator.PublicStatus"/> over the collectible
        /// amount; scripts/test_customer_portal.py cross-checks every bucket
        /// against the calculator so the two cannot drift unnoticed.
        /// </summary>
        private static IQueryable<Invoice> ApplyStatusFilter(IQueryable<Invoice> q, string? status)
        {
            if (string.IsNullOrWhiteSpace(status) || status.Equals("All", StringComparison.OrdinalIgnoreCase))
                return q;

            var today = PakistanClock.Today;

            // collectible = max(0, GrandTotal - WithholdingTaxAmount)
            return status.Trim().ToLowerInvariant() switch
            {
                "paid" => q.Where(i =>
                    i.AmountPaid == (i.GrandTotal - i.WithholdingTaxAmount < 0 ? 0 : i.GrandTotal - i.WithholdingTaxAmount)),
                "overpaid" => q.Where(i =>
                    i.AmountPaid > (i.GrandTotal - i.WithholdingTaxAmount < 0 ? 0 : i.GrandTotal - i.WithholdingTaxAmount)),
                "unpaid" => q.Where(i =>
                    i.AmountPaid < (i.GrandTotal - i.WithholdingTaxAmount < 0 ? 0 : i.GrandTotal - i.WithholdingTaxAmount)
                    && i.AmountPaid == 0
                    && (i.DueDate == null || i.DueDate.Value.Date >= today)),
                "partiallypaid" or "partial" => q.Where(i =>
                    i.AmountPaid < (i.GrandTotal - i.WithholdingTaxAmount < 0 ? 0 : i.GrandTotal - i.WithholdingTaxAmount)
                    && i.AmountPaid > 0
                    && (i.DueDate == null || i.DueDate.Value.Date >= today)),
                "overdue" => q.Where(i =>
                    i.AmountPaid < (i.GrandTotal - i.WithholdingTaxAmount < 0 ? 0 : i.GrandTotal - i.WithholdingTaxAmount)
                    && i.DueDate != null && i.DueDate.Value.Date < today),
                // An unknown filter shows nothing rather than silently showing all.
                _ => q.Where(i => false),
            };
        }

        public async Task<PortalInvoiceDetailDto?> GetInvoiceAsync(ResolvedPortal portal, int invoiceNumber)
        {
            var inv = await VisibleInvoices(portal)
                .Include(i => i.Items)
                .Include(i => i.Client)
                .FirstOrDefaultAsync(i => i.InvoiceNumber == invoiceNumber);
            if (inv == null) return null;

            var total = WithholdingTaxCalculator.Collectible(inv.GrandTotal, inv.WithholdingTaxAmount);
            return new PortalInvoiceDetailDto
            {
                InvoiceNumber = inv.InvoiceNumber,
                Date = inv.Date,
                DueDate = inv.DueDate,
                Status = PaymentStatusCalculator.PublicStatus(total, inv.AmountPaid, inv.DueDate).ToString(),
                PaymentTerms = inv.PaymentTerms,
                PoNumber = inv.PoNumber,
                PoDate = inv.PoDate,

                ClientName = inv.Client?.Name ?? "",
                ClientAddress = inv.Client?.Address,
                ClientPhone = inv.Client?.Phone,
                ClientNTN = inv.Client?.NTN,

                Subtotal = inv.Subtotal,
                GSTRate = inv.GSTRate,
                GSTAmount = inv.GSTAmount,
                GrandTotal = inv.GrandTotal,
                WithholdingTaxAmount = inv.WithholdingTaxAmount,
                Total = total,
                Paid = inv.AmountPaid,
                Balance = PaymentStatusCalculator.BalanceDue(total, inv.AmountPaid),
                Credit = PaymentStatusCalculator.CreditBalance(total, inv.AmountPaid),
                AmountInWords = inv.AmountInWords,

                Items = inv.Items.Select(it => new PortalInvoiceItemDto
                {
                    Description = it.Description,
                    Quantity = it.Quantity,
                    UOM = it.UOM,
                    UnitPrice = it.UnitPrice,
                    LineTotal = it.LineTotal,
                    HSCode = it.HSCode,
                }).ToList(),
            };
        }

        /// <summary>
        /// A template of one type for an invoice: its own division's default
        /// first, then the company-level default, oldest row breaking a tie.
        ///
        /// Resolved here rather than through IPrintTemplateRepository because the
        /// repository has no HTML equivalent — GetByCompanyAndTypeAsync ignores
        /// division scope, and GetForExportAsync (despite the name) filters on
        /// ExcelTemplatePath != null, so it only ever finds templates that carry
        /// an Excel workbook. Using it for HTML print silently returns nothing for
        /// every company that has a normal print template and no Excel one.
        /// The ordering below deliberately mirrors GetForExportAsync minus that
        /// filter, so the portal picks the same template the office would.
        /// </summary>
        private async Task<PrintTemplate?> ResolveTemplateAsync(int companyId, int? divisionId, string templateType)
        {
            if (divisionId.HasValue)
            {
                var div = await _context.PrintTemplates.AsNoTracking()
                    .Where(t => t.CompanyId == companyId && t.TemplateType == templateType
                             && t.DivisionId == divisionId.Value)
                    .OrderByDescending(t => t.IsDefault).ThenBy(t => t.Id)
                    .FirstOrDefaultAsync();
                if (div != null) return div;
            }
            return await _context.PrintTemplates.AsNoTracking()
                .Where(t => t.CompanyId == companyId && t.TemplateType == templateType && t.DivisionId == null)
                .OrderByDescending(t => t.IsDefault).ThenBy(t => t.Id)
                .FirstOrDefaultAsync();
        }

        /// <summary>
        /// The document the customer gets, and the merge data that belongs with it.
        ///
        /// A company may have configured a Bill template, a Tax Invoice template,
        /// or both — many configure only one, and which one is not predictable.
        /// The two are NOT interchangeable: a Tax Invoice template is written
        /// against the FBR merge fields (IRN, QR, scenario) that only
        /// GetPrintTaxInvoiceAsync supplies, so handing it Bill data would render
        /// a half-empty document. Template and data are therefore chosen together.
        ///
        /// Bill wins when both exist: it is the commercial document and its data is
        /// complete whether or not the invoice was ever sent to FBR, whereas a Tax
        /// Invoice only carries an IRN once submitted. A company that wants the
        /// customer to receive the Tax Invoice can simply not configure a Bill one.
        /// </summary>
        private async Task<(PrintTemplate? Template, object? PrintData)> ResolveDocumentAsync(
            int companyId, int? divisionId, int invoiceId, string? chosenType)
        {
            // An explicit choice is absolute — no falling back to the other
            // document. The operator picked what the customer receives.
            if (chosenType != null)
            {
                var picked = await ResolveTemplateAsync(companyId, divisionId, chosenType);
                if (picked == null) return (null, null);
                object? data = chosenType == "TaxInvoice"
                    ? await _invoices.GetPrintTaxInvoiceAsync(invoiceId)
                    : await _invoices.GetPrintBillAsync(invoiceId);
                return data == null ? (null, null) : (picked, data);
            }

            var bill = await ResolveTemplateAsync(companyId, divisionId, "Bill");
            if (bill != null)
            {
                var data = await _invoices.GetPrintBillAsync(invoiceId);
                if (data != null) return (bill, data);
            }

            var tax = await ResolveTemplateAsync(companyId, divisionId, "TaxInvoice");
            if (tax != null)
            {
                var data = await _invoices.GetPrintTaxInvoiceAsync(invoiceId);
                if (data != null) return (tax, data);
            }

            return (null, null);
        }

        public async Task<PortalPrintPayloadDto?> GetPrintPayloadAsync(ResolvedPortal portal, int invoiceNumber)
        {
            // Ownership first: resolve the invoice through the portal's own scope,
            // never by id from the caller. GetPrintBillAsync performs no ownership
            // check of its own, so this lookup IS the check.
            var owned = await VisibleInvoices(portal)
                .Where(i => i.InvoiceNumber == invoiceNumber)
                .Select(i => new { i.Id, i.DivisionId })
                .FirstOrDefaultAsync();
            if (owned == null) return null;

            var (template, printData) = await ResolveDocumentAsync(
                portal.CompanyId, owned.DivisionId, owned.Id, portal.DocumentType);
            if (template == null || printData == null) return null;

            // A stamped template must stay stamped, or the customer's copy differs
            // from the one the office prints. Only the stamp this template
            // references is exposed — not the company's stamp library.
            var stampMap = new Dictionary<string, string>();
            if (template.StampId.HasValue)
            {
                var stamp = await _context.CompanyStamps.AsNoTracking()
                    .Where(s => s.Id == template.StampId.Value && s.CompanyId == portal.CompanyId)
                    .Select(s => new { s.Slug, s.FilePath })
                    .FirstOrDefaultAsync();
                if (stamp != null && !string.IsNullOrWhiteSpace(stamp.Slug))
                    stampMap[stamp.Slug] = stamp.FilePath;
            }

            return new PortalPrintPayloadDto
            {
                InvoiceNumber = invoiceNumber,
                TemplateHtml = template.HtmlContent,
                PrintData = printData,
                StampMap = stampMap,
                FileNameBase = $"Invoice-{invoiceNumber}",
            };
        }
    }
}
