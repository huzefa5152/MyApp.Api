using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class CustomerPortalService : ICustomerPortalService
    {
        private readonly AppDbContext _context;
        private readonly IInvoiceService _invoices;
        private readonly ILogger<CustomerPortalService> _logger;

        /// <summary>The two documents a customer can be given a copy of.</summary>
        private const string DocBill = "Bill";
        private const string DocTaxInvoice = "TaxInvoice";

        public CustomerPortalService(AppDbContext context, IInvoiceService invoices,
            ILogger<CustomerPortalService> logger)
        {
            _context = context;
            _invoices = invoices;
            _logger = logger;
        }

        private static string Label(string? documentType) => documentType switch
        {
            DocBill => "Bill",
            DocTaxInvoice => "Tax Invoice",
            _ => "Automatic",
        };

        /// <summary>Only the two known values survive. Anything else — including
        /// a plausible-looking template name — becomes null, which means
        /// "choose automatically" rather than an unknown template type nothing
        /// can resolve.</summary>
        private static string? NormalizeDocumentType(string? raw)
        {
            var t = raw?.Trim();
            if (string.Equals(t, DocBill, StringComparison.OrdinalIgnoreCase)) return DocBill;
            if (string.Equals(t, DocTaxInvoice, StringComparison.OrdinalIgnoreCase)) return DocTaxInvoice;
            return null;
        }

        // ── Management ────────────────────────────────────────────────────────

        private async Task<CustomerPortalDto> ToDtoAsync(CustomerPortal p, Func<string, string> urlBuilder)
        {
            var options = await GetDocumentOptionsAsync(p.CompanyId);
            var effective = p.DocumentType
                ?? (options.Any(o => o.Type == DocBill && o.Available) ? DocBill : DocTaxInvoice);

            return new CustomerPortalDto
            {
                Id = p.Id,
                CompanyId = p.CompanyId,
                CompanyName = p.Company?.BrandName ?? p.Company?.Name ?? "",
                ClientId = p.ClientId,
                ClientName = p.Client?.Name ?? "",
                PublicUrl = urlBuilder(p.PublicToken),
                IsActive = p.IsActive,
                DocumentType = p.DocumentType,
                DocumentTypeLabel = Label(p.DocumentType),
                TemplateAvailable = options.Any(o => o.Type == effective && o.Available),
                AvailableDocumentTypes = options.Where(o => o.Available).Select(o => o.Type).ToList(),
                CreatedAt = p.CreatedAt,
                DisabledAt = p.DisabledAt,
            };
        }

        public async Task<List<CustomerPortalDto>> GetAllAsync(
            IReadOnlyCollection<int> allowedCompanyIds, Func<string, string> urlBuilder)
        {
            // Scoped to the caller's accessible companies IN THE QUERY, not
            // filtered afterwards — a portal row carries a live bearer token, so
            // one that is merely filtered out of the response has still been
            // read and could still be logged on the way past.
            var rows = await _context.CustomerPortals.AsNoTracking()
                .Where(p => allowedCompanyIds.Contains(p.CompanyId))
                .Include(p => p.Company)
                .Include(p => p.Client)
                .OrderByDescending(p => p.IsActive).ThenBy(p => p.Id)
                .ToListAsync();

            var list = new List<CustomerPortalDto>(rows.Count);
            foreach (var p in rows) list.Add(await ToDtoAsync(p, urlBuilder));
            return list;
        }

        public async Task<CustomerPortalDto?> GetByIdAsync(int id, Func<string, string> urlBuilder)
        {
            var p = await _context.CustomerPortals.AsNoTracking()
                .Include(x => x.Company).Include(x => x.Client)
                .FirstOrDefaultAsync(x => x.Id == id);
            return p == null ? null : await ToDtoAsync(p, urlBuilder);
        }

        public async Task<CustomerPortalDto> CreateAsync(
            int companyId, int clientId, string? documentType, int userId, Func<string, string> urlBuilder)
        {
            // Cross-tenant link guard: the client must belong to the company the
            // portal is for, or the portal would publish one tenant's invoices
            // under another's branding.
            var client = await _context.Clients.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == clientId && c.CompanyId == companyId)
                ?? throw new InvalidOperationException("That client does not belong to this company.");

            if (await _context.CustomerPortals.AnyAsync(p =>
                    p.CompanyId == companyId && p.ClientId == clientId && p.IsActive))
                throw new InvalidOperationException(
                    $"{client.Name} already has an active portal. Disable it first, or send the existing link.");

            var portal = new CustomerPortal
            {
                CompanyId = companyId,
                ClientId = clientId,
                DocumentType = NormalizeDocumentType(documentType),
                PublicToken = PublicTokenGenerator.Create(),
                IsActive = true,
                CreatedByUserId = userId,
            };

            // Retry on the token's unique index rather than probing first: a
            // check-then-insert would race, and a collision at 256 bits is a
            // theoretical courtesy rather than an expected event.
            await NumberAllocationRetry.ExecuteAsync(async attempt =>
            {
                if (attempt > 1) portal.PublicToken = PublicTokenGenerator.Create();
                _context.CustomerPortals.Add(portal);
                await _context.SaveChangesAsync();
                return portal.Id;
            });

            await _context.Entry(portal).Reference(p => p.Company).LoadAsync();
            await _context.Entry(portal).Reference(p => p.Client).LoadAsync();
            return await ToDtoAsync(portal, urlBuilder);
        }

        public async Task<CustomerPortalDto?> SetDocumentTypeAsync(
            int id, string? documentType, int userId, Func<string, string> urlBuilder)
        {
            var p = await _context.CustomerPortals
                .Include(x => x.Company).Include(x => x.Client)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (p == null) return null;

            p.DocumentType = NormalizeDocumentType(documentType);
            p.UpdatedAt = DateTime.UtcNow;
            p.UpdatedByUserId = userId;
            await _context.SaveChangesAsync();
            return await ToDtoAsync(p, urlBuilder);
        }

        public async Task<List<PortalDocumentOptionDto>> GetDocumentOptionsAsync(int companyId)
        {
            var types = await _context.PrintTemplates.AsNoTracking()
                .Where(t => t.CompanyId == companyId)
                .Select(t => t.TemplateType)
                .Distinct()
                .ToListAsync();

            return new List<PortalDocumentOptionDto>
            {
                new() { Type = DocBill, Label = "Bill", Available = types.Contains(DocBill) },
                new() { Type = DocTaxInvoice, Label = "Tax Invoice", Available = types.Contains(DocTaxInvoice) },
            };
        }

        public async Task<CustomerPortalDto?> SetActiveAsync(
            int id, bool isActive, int userId, Func<string, string> urlBuilder)
        {
            var p = await _context.CustomerPortals
                .Include(x => x.Company).Include(x => x.Client)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (p == null) return null;

            if (isActive && !p.IsActive
                && await _context.CustomerPortals.AnyAsync(x =>
                    x.CompanyId == p.CompanyId && x.ClientId == p.ClientId && x.IsActive && x.Id != p.Id))
            {
                throw new InvalidOperationException(
                    "This customer already has another active portal. Disable that one first.");
            }

            p.IsActive = isActive;
            p.DisabledAt = isActive ? null : DateTime.UtcNow;
            p.UpdatedAt = DateTime.UtcNow;
            p.UpdatedByUserId = userId;
            await _context.SaveChangesAsync();
            return await ToDtoAsync(p, urlBuilder);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var p = await _context.CustomerPortals.FirstOrDefaultAsync(x => x.Id == id);
            if (p == null) return false;
            _context.CustomerPortals.Remove(p);
            await _context.SaveChangesAsync();
            return true;
        }

        // ── Public ────────────────────────────────────────────────────────────

        public async Task<ResolvedPortal?> ResolveAsync(string token)
        {
            // Shape check first, so a junk path segment costs a string scan
            // instead of a database round trip.
            if (!PublicTokenGenerator.LooksValid(token)) return null;
            return await _context.CustomerPortals.AsNoTracking()
                .Where(p => p.PublicToken == token && p.IsActive)
                .Select(p => new ResolvedPortal(p.Id, p.CompanyId, p.ClientId, p.DocumentType))
                .FirstOrDefaultAsync();
        }

        /// <summary>
        /// THE tenant boundary. Every public read composes from this and nothing
        /// else, so there is one place to get it right and one place to audit.
        ///
        /// It filters on BOTH CompanyId and ClientId — not just the client —
        /// because a client id is only unique within a company, and a portal
        /// that trusted the client alone would be one renumbering away from
        /// showing another tenant's invoices.
        ///
        /// It also excludes what a customer has no business seeing: credit and
        /// debit notes (their own numbering and meaning, and a partial reversal
        /// out of context reads as a second bill), cancelled bills, demo rows,
        /// and anything the operator flagged out of FBR.
        /// </summary>
        private IQueryable<Invoice> VisibleInvoices(ResolvedPortal portal) =>
            _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == portal.CompanyId
                         && i.ClientId == portal.ClientId
                         && i.NoteKind == 0
                         && !i.IsCancelled
                         && !i.IsDemo
                         && !i.IsFbrExcluded);

        /// <summary>What the customer actually owes on a document: the grand
        /// total less anything withheld at source, which never reaches us.</summary>
        private static decimal Collectible(decimal grandTotal, decimal withholding) =>
            WithholdingTaxCalculator.Collectible(grandTotal, withholding);

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
                    ClientName = p.Client.Name,
                })
                .FirstOrDefaultAsync();
            if (head == null) return null;

            var options = await GetDocumentOptionsAsync(portal.CompanyId);
            var effective = portal.DocumentType
                ?? (options.Any(o => o.Type == DocBill && o.Available) ? DocBill : DocTaxInvoice);

            // The summary covers EVERY visible invoice, not the current page,
            // and runs through the canonical calculators in memory rather than a
            // SQL rewrite — these are the numbers the customer will argue about,
            // so they have to be the same ones the office sees. The projection is
            // four columns wide and scoped to one client, so it stays cheap.
            var rows = await VisibleInvoices(portal)
                .Select(i => new { i.GrandTotal, i.WithholdingTaxAmount, i.AmountPaid, i.DueDate })
                .ToListAsync();

            var summary = new PortalSummaryDto { TotalInvoices = rows.Count };
            foreach (var r in rows)
            {
                var total = Collectible(r.GrandTotal, r.WithholdingTaxAmount);
                var status = PaymentStatusCalculator.Status(total, r.AmountPaid, r.DueDate);

                summary.TotalAmount += total;
                summary.PaidAmount += r.AmountPaid;
                summary.OutstandingAmount += PaymentStatusCalculator.BalanceDue(total, r.AmountPaid);

                switch (status)
                {
                    case PaymentStatus.Paid: summary.PaidCount++; break;
                    case PaymentStatus.Unpaid: summary.UnpaidCount++; break;
                    case PaymentStatus.PartiallyPaid: summary.PartiallyPaidCount++; break;
                    case PaymentStatus.Overdue: summary.OverdueCount++; break;
                }
            }

            return new PortalHeaderDto
            {
                CompanyName = head.CompanyName ?? "",
                CompanyLogoPath = head.LogoPath,
                CompanyAddress = head.FullAddress,
                CompanyPhone = head.Phone,
                CompanyNtn = head.NTN,
                ClientName = head.ClientName,
                DocumentType = effective,
                CanPrint = options.Any(o => o.Type == effective && o.Available),
                Summary = summary,
            };
        }

        public async Task<PagedResult<PortalInvoiceListItemDto>> GetInvoicesAsync(
            ResolvedPortal portal, int page, int pageSize,
            string? status, string? search, DateTime? dateFrom, DateTime? dateTo)
        {
            var query = VisibleInvoices(portal);

            if (dateFrom.HasValue) query = query.Where(i => i.Date >= dateFrom.Value.Date);
            if (dateTo.HasValue) query = query.Where(i => i.Date <= dateTo.Value.Date);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim();
                var asNumber = int.TryParse(new string(term.Where(char.IsDigit).ToArray()), out var n) ? n : (int?)null;
                query = query.Where(i =>
                    (asNumber != null && i.InvoiceNumber == asNumber)
                    || (i.PoNumber != null && i.PoNumber.Contains(term)));
            }

            var rows = await query
                .OrderByDescending(i => i.Date).ThenByDescending(i => i.InvoiceNumber)
                .Select(i => new
                {
                    i.InvoiceNumber, i.Date, i.DueDate, i.PoNumber,
                    i.GrandTotal, i.WithholdingTaxAmount, i.AmountPaid,
                })
                .ToListAsync();

            // Status is derived (it depends on today's date), so it cannot be
            // filtered in SQL without duplicating the calculator. Filtering in
            // memory keeps ONE definition of "overdue"; the set is one client's
            // invoices, so the cost is a list, not a table scan.
            var items = rows.Select(r =>
            {
                var amount = Collectible(r.GrandTotal, r.WithholdingTaxAmount);
                return new PortalInvoiceListItemDto
                {
                    InvoiceNumber = r.InvoiceNumber,
                    Date = r.Date,
                    DueDate = r.DueDate,
                    PoNumber = r.PoNumber,
                    Amount = amount,
                    AmountPaid = r.AmountPaid,
                    BalanceDue = PaymentStatusCalculator.BalanceDue(amount, r.AmountPaid),
                    PaymentStatus = PaymentStatusCalculator.Status(amount, r.AmountPaid, r.DueDate).ToString(),
                    DaysOverdue = PaymentStatusCalculator.DaysOverdue(amount, r.AmountPaid, r.DueDate),
                };
            }).ToList();

            if (!string.IsNullOrWhiteSpace(status))
            {
                var wanted = status.Trim();
                items = items.Where(i => string.Equals(i.PaymentStatus, wanted, StringComparison.OrdinalIgnoreCase)).ToList();
            }

            var totalCount = items.Count;
            return new PagedResult<PortalInvoiceListItemDto>
            {
                Items = items.Skip((page - 1) * pageSize).Take(pageSize).ToList(),
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
            };
        }

        public async Task<PortalInvoiceDetailDto?> GetInvoiceAsync(ResolvedPortal portal, int invoiceNumber)
        {
            // Composed from VisibleInvoices, so the number is looked up INSIDE
            // the portal's scope. Another client's invoice number does not exist
            // from here — there is nothing to compare against and nothing to
            // leak, because the row is never loaded.
            var inv = await VisibleInvoices(portal)
                .Where(i => i.InvoiceNumber == invoiceNumber)
                .Select(i => new
                {
                    i.Id, i.InvoiceNumber, i.Date, i.DueDate, i.PoNumber,
                    i.Subtotal, i.GSTRate, i.GSTAmount, i.FurtherTaxAmount,
                    i.WithholdingTaxAmount, i.GrandTotal, i.AmountPaid, i.AmountInWords,
                })
                .FirstOrDefaultAsync();
            if (inv == null) return null;

            var lines = await _context.InvoiceItems.AsNoTracking()
                .Where(it => it.InvoiceId == inv.Id)
                .OrderBy(it => it.Id)
                .Select(it => new PortalInvoiceLineDto
                {
                    Description = it.Description,
                    Quantity = it.Quantity,
                    Uom = it.UOM,
                    UnitPrice = it.UnitPrice,
                    LineTotal = it.LineTotal,
                })
                .ToListAsync();

            var amount = Collectible(inv.GrandTotal, inv.WithholdingTaxAmount);
            return new PortalInvoiceDetailDto
            {
                InvoiceNumber = inv.InvoiceNumber,
                Date = inv.Date,
                DueDate = inv.DueDate,
                PoNumber = inv.PoNumber,
                Subtotal = inv.Subtotal,
                GstRate = inv.GSTRate,
                GstAmount = inv.GSTAmount,
                FurtherTaxAmount = inv.FurtherTaxAmount,
                WithholdingTaxAmount = inv.WithholdingTaxAmount,
                GrandTotal = inv.GrandTotal,
                Amount = amount,
                AmountPaid = inv.AmountPaid,
                BalanceDue = PaymentStatusCalculator.BalanceDue(amount, inv.AmountPaid),
                PaymentStatus = PaymentStatusCalculator.Status(amount, inv.AmountPaid, inv.DueDate).ToString(),
                DaysOverdue = PaymentStatusCalculator.DaysOverdue(amount, inv.AmountPaid, inv.DueDate),
                AmountInWords = inv.AmountInWords,
                Lines = lines,
            };
        }

        public async Task<PortalPrintPayloadDto?> GetPrintPayloadAsync(ResolvedPortal portal, int invoiceNumber)
        {
            // Scope first, ALWAYS. The invoice id that reaches the print
            // services below is one this portal owns, because it came out of
            // VisibleInvoices — the caller never supplies it.
            var invoiceId = await VisibleInvoices(portal)
                .Where(i => i.InvoiceNumber == invoiceNumber)
                .Select(i => (int?)i.Id)
                .FirstOrDefaultAsync();
            if (invoiceId == null) return null;

            var options = await GetDocumentOptionsAsync(portal.CompanyId);
            var documentType = portal.DocumentType
                ?? (options.Any(o => o.Type == DocBill && o.Available) ? DocBill : DocTaxInvoice);

            var template = await _context.PrintTemplates.AsNoTracking()
                .Where(t => t.CompanyId == portal.CompanyId && t.TemplateType == documentType)
                .OrderByDescending(t => t.IsDefault).ThenBy(t => t.Id)
                .Select(t => t.HtmlContent)
                .FirstOrDefaultAsync();
            if (string.IsNullOrWhiteSpace(template))
            {
                _logger.LogInformation(
                    "Portal {PortalId} asked for a {DocumentType} but company {CompanyId} has no such template.",
                    portal.PortalId, documentType, portal.CompanyId);
                return null;
            }

            object? data = documentType == DocBill
                ? await _invoices.GetPrintBillAsync(invoiceId.Value)
                : await _invoices.GetPrintTaxInvoiceAsync(invoiceId.Value);
            if (data == null) return null;

            return new PortalPrintPayloadDto
            {
                DocumentType = documentType,
                TemplateHtml = template,
                Data = data,
            };
        }
    }
}
