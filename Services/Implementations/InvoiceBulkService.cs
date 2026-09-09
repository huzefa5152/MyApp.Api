using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// See <see cref="IInvoiceBulkService"/> for the architecture and the
    /// porting note. This file is the whole server half of bulk invoice
    /// download / consolidated print, for both the internal screen and the
    /// public portal.
    /// </summary>
    public class InvoiceBulkService : IInvoiceBulkService
    {
        /// <summary>
        /// Hard ceiling on one operation, enforced here rather than in a
        /// controller so both entry points get it.
        ///
        /// The binding constraint is the BROWSER, not the database: each page is
        /// rasterised by html2canvas at scale 2 (~2.3 megapixels) and embedded
        /// as a JPEG, so roughly 200–400 KB per page live in memory until the
        /// document is saved. 200 invoices is tens of megabytes and minutes of
        /// work; 1,000 kills the tab. The busiest month on this installation is
        /// 31 invoices, so this is a guard rail rather than a limit anyone meets
        /// in normal use — and <see cref="InvoiceBulkBatchDto.Truncated"/> is
        /// what stops a truncated run being mistaken for a complete one.
        /// </summary>
        public const int MaxBatchSize = 200;

        private readonly AppDbContext _context;
        private readonly IInvoiceService _invoices;

        public InvoiceBulkService(AppDbContext context, IInvoiceService invoices)
        {
            _context = context;
            _invoices = invoices;
        }

        public async Task<InvoiceBulkBatchDto> ResolveBatchAsync(
            InvoiceBulkScope scope, InvoiceBulkRequestDto request)
        {
            ArgumentNullException.ThrowIfNull(scope);
            ArgumentNullException.ThrowIfNull(request);

            var documentType = NormalizeDocumentType(request.DocumentType);
            var window = ResolveWindow(request);

            var batch = new InvoiceBulkBatchDto
            {
                Limit = MaxBatchSize,
                WindowFrom = window.From,
                WindowTo = window.To,
                WindowLabel = window.Label,
            };

            var candidates = await SelectCandidatesAsync(scope, request, window);
            batch.MatchedCount = candidates.Count;
            batch.Truncated = candidates.Count > MaxBatchSize;
            var selected = batch.Truncated ? candidates.Take(MaxBatchSize).ToList() : candidates;

            var pinned = request.TemplateId.HasValue
                ? await LoadPinnedTemplateAsync(scope, request.TemplateId.Value, documentType)
                : null;

            // Templates are keyed on (company, division, type) and resolved once
            // per distinct scope rather than per invoice — a 200-invoice batch on
            // one company is then one template lookup, not two hundred.
            // Keyed on the division, with 0 standing in for "company level".
            // A Dictionary<int?, T> THROWS on a null key, and a company-level
            // invoice — the common case — has DivisionId null, so the nullable
            // key would fail on the very first row.
            var templateCache = new Dictionary<int, PrintTemplate?>();
            var emitted = new Dictionary<int, InvoiceBulkTemplateDto>();
            var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var row in selected)
            {
                // A migrated document has no line items — it was imported as a
                // ledger balance, not as a sale — so it renders as a header with
                // an empty table. Saying so beats handing over a blank invoice.
                if (row.IsMigrated)
                {
                    batch.Skipped.Add(Skip(row, "Imported history — this document has no line items to print."));
                    continue;
                }

                var template = pinned;
                if (template == null)
                {
                    var cacheKey = row.DivisionId ?? 0;
                    if (!templateCache.TryGetValue(cacheKey, out template))
                    {
                        template = await ResolveTemplateAsync(scope.CompanyId, row.DivisionId, documentType);
                        templateCache[cacheKey] = template;
                    }
                }

                if (template == null)
                {
                    batch.Skipped.Add(Skip(row,
                        $"No {Label(documentType)} print template is configured for this company."));
                    continue;
                }

                // The SAME builders the single-invoice print and PDF paths call.
                // There is no bulk-specific merge shape, which is what makes a
                // bulk PDF and a one-off PDF of the same invoice identical.
                object? printData = documentType == "TaxInvoice"
                    ? await _invoices.GetPrintTaxInvoiceAsync(row.Id)
                    : await _invoices.GetPrintBillAsync(row.Id);

                if (printData == null)
                {
                    batch.Skipped.Add(Skip(row, "This document's print data could not be built."));
                    continue;
                }

                if (!emitted.ContainsKey(template.Id))
                    emitted[template.Id] = await ToTemplateDtoAsync(template, scope.CompanyId);

                batch.Invoices.Add(new InvoiceBulkInvoiceDto
                {
                    InvoiceNumber = row.InvoiceNumber,
                    Reference = row.Reference,
                    Date = row.Date,
                    ClientName = row.ClientName ?? "",
                    TemplateId = template.Id,
                    FileNameBase = UniqueName(usedNames, row),
                    PrintData = printData,
                });
            }

            batch.Templates = emitted.Values.ToList();
            batch.FileNameBase = BatchFileName(documentType, window);
            return batch;
        }

        // ── Selection ────────────────────────────────────────────────────────

        private sealed record Candidate(
            int Id, int InvoiceNumber, string? Reference, DateTime Date,
            string? ClientName, int? DivisionId, bool IsMigrated);

        /// <summary>
        /// THE tenant boundary for a bulk run, and the only place the invoice set
        /// is chosen.
        ///
        /// The excluded documents mirror what every report and the portal already
        /// exclude, for the same reasons: a CANCELLED document is not a sale, a
        /// DEMO row is sandbox noise, and a credit/debit NOTE has its own
        /// numbering and meaning so it cannot be printed as an invoice.
        ///
        /// Deliberately NOT excluded: an invoice never filed with FBR. A Tax
        /// Invoice template's FBR block is wrapped in <c>{{#if fbrIRN}}</c>, so
        /// an unfiled document renders correctly without it — and refusing to
        /// print the commercial document until the tax authority has accepted it
        /// would be a rule nobody asked for.
        /// </summary>
        private async Task<List<Candidate>> SelectCandidatesAsync(
            InvoiceBulkScope scope, InvoiceBulkRequestDto request, ReportWindow window)
        {
            var q = _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == scope.CompanyId
                         && i.NoteKind == 0
                         && !i.IsCancelled
                         && !i.IsDemo);

            if (scope.IsCustomerPortal)
            {
                // Pinned by the token, not by the request. IsFbrExcluded is
                // excluded here and NOT for an internal caller: on the portal it
                // matches the existing VisibleInvoices contract, while
                // internally that flag governs FBR bulk validate/submit and has
                // never meant "do not print".
                q = q.Where(i => i.ClientId == scope.PortalClientId!.Value && !i.IsFbrExcluded);
            }
            else
            {
                if (request.ClientId.HasValue)
                    q = q.Where(i => i.ClientId == request.ClientId.Value);

                if (request.DivisionId.HasValue)
                    q = q.Where(i => i.DivisionId == request.DivisionId.Value);
                else if (scope.AllowedDivisionIds != null)
                {
                    // An empty allowed set means "restricted to no division" and
                    // must match nothing but company-level rows. Treating null
                    // and empty alike is how a division guard silently becomes a
                    // no-op for exactly the caller it exists for.
                    var allowed = scope.AllowedDivisionIds;
                    q = q.Where(i => i.DivisionId == null || allowed.Contains(i.DivisionId.Value));
                }

                if (!string.IsNullOrWhiteSpace(request.Search)
                    && int.TryParse(request.Search.Trim(), out var num))
                {
                    q = q.Where(i => i.InvoiceNumber == num);
                }
            }

            // Invoice.Date is the DOCUMENT date — what the customer's copy says
            // and what the existing list filter uses. Not CreatedAt (imported
            // history was written long after the sale) and not FbrSubmittedAt
            // (null on everything unfiled).
            if (window.From.HasValue) q = q.Where(i => i.Date >= window.From.Value);
            if (window.To.HasValue) q = q.Where(i => i.Date <= window.To.Value);

            return await q
                .OrderBy(i => i.Date).ThenBy(i => i.InvoiceNumber)
                .Select(i => new Candidate(
                    i.Id, i.InvoiceNumber, i.FbrInvoiceNumber, i.Date,
                    i.Client != null ? i.Client.Name : null,
                    i.DivisionId, i.IsMigrated))
                .ToListAsync();
        }

        // ── Templates ────────────────────────────────────────────────────────

        /// <summary>
        /// Mirrors <c>CustomerPortalService.ResolveTemplateAsync</c>: the
        /// division's own template first, then the company-level one, default
        /// flag first and lowest id as the tie-break — so a bulk run picks the
        /// same template the office would for that document on its own.
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
        /// A pinned template must belong to the scope's company and be of the
        /// requested type. A template row carries its own company's letterhead,
        /// logo and stamp, so rendering one company's invoice through another's
        /// template does not merely look wrong — it produces a document with the
        /// wrong business's identity on it. Refused outright.
        ///
        /// A portal never pins: the customer gets the company's configured
        /// document, and template choice is internal configuration they have no
        /// basis to make.
        /// </summary>
        private async Task<PrintTemplate?> LoadPinnedTemplateAsync(
            InvoiceBulkScope scope, int templateId, string documentType)
        {
            if (scope.IsCustomerPortal)
                throw new InvalidOperationException("A customer portal always uses the company's configured template.");

            var template = await _context.PrintTemplates.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == templateId
                                       && t.CompanyId == scope.CompanyId
                                       && t.TemplateType == documentType);

            if (template == null)
                throw new InvalidOperationException(
                    $"That {Label(documentType)} template does not belong to this company.");

            return template;
        }

        private async Task<InvoiceBulkTemplateDto> ToTemplateDtoAsync(PrintTemplate template, int companyId)
        {
            var dto = new InvoiceBulkTemplateDto
            {
                Id = template.Id,
                Name = template.Name,
                HtmlContent = template.HtmlContent,
            };

            if (template.StampId.HasValue)
            {
                var stamp = await _context.CompanyStamps.AsNoTracking()
                    .Where(s => s.Id == template.StampId.Value && s.CompanyId == companyId)
                    .Select(s => new { s.Slug, s.FilePath })
                    .FirstOrDefaultAsync();
                if (stamp != null && !string.IsNullOrWhiteSpace(stamp.Slug))
                    dto.StampMap[stamp.Slug] = stamp.FilePath;
            }

            return dto;
        }

        // ── Naming ───────────────────────────────────────────────────────────

        /// <summary>
        /// A per-file name that stays unambiguous inside one archive.
        ///
        /// <c>UNIQUE (CompanyId, InvoiceNumber)</c> makes an invoice number
        /// unique per COMPANY only, so the number alone is not a safe file name.
        /// The reference already carries the company's own prefix ("PTC-52"), so
        /// it is used when present and the bare number when the company has set
        /// no prefix. The client name follows because that is what an operator
        /// scans a folder for.
        /// </summary>
        private static string UniqueName(HashSet<string> used, Candidate row)
        {
            var reference = string.IsNullOrWhiteSpace(row.Reference)
                ? row.InvoiceNumber.ToString()
                : row.Reference!;
            var name = Sanitize(reference);
            var client = Sanitize(row.ClientName ?? "");
            if (client.Length > 40) client = client[..40].TrimEnd('-');
            if (client.Length > 0) name = $"{name}_{client}";

            // Two different clients can sanitise to the same string, and a ZIP
            // entry written twice under one name loses the first copy silently.
            var candidate = name;
            var n = 2;
            while (!used.Add(candidate))
                candidate = $"{name}-{n++}";
            return candidate;
        }

        private static string BatchFileName(string documentType, ReportWindow window)
        {
            var prefix = documentType == "TaxInvoice" ? "SalesTaxInvoices" : "Bills";
            if (window.IsAllPeriods) return $"{prefix}_all-dates";
            var from = window.From?.ToString("yyyy-MM-dd") ?? "start";
            var to = window.To?.ToString("yyyy-MM-dd") ?? "today";
            return $"{prefix}_{from}_to_{to}";
        }

        /// <summary>
        /// Reduce an operator-supplied string to characters that are safe in a
        /// file name on every platform AND inside a ZIP entry. Deliberately
        /// stricter than <c>Path.GetInvalidFileNameChars</c>, which permits
        /// spaces, quotes and semicolons that go on to confuse shells and
        /// Content-Disposition headers.
        /// </summary>
        private static string Sanitize(string raw)
        {
            var chars = new List<char>(raw.Length);
            var lastDash = false;
            foreach (var c in raw.Trim())
            {
                if (char.IsLetterOrDigit(c) || c is '.' or '_' or '-')
                {
                    chars.Add(c);
                    lastDash = c == '-';
                }
                else if (!lastDash && chars.Count > 0)
                {
                    chars.Add('-');
                    lastDash = true;
                }
            }
            var s = new string(chars.ToArray()).Trim('-', '.', '_');
            return s.Length == 0 ? "document" : s;
        }

        // ── Small helpers ────────────────────────────────────────────────────

        private static InvoiceBulkSkippedDto Skip(Candidate row, string reason) => new()
        {
            InvoiceNumber = row.InvoiceNumber,
            Reference = row.Reference,
            Reason = reason,
        };

        private static ReportWindow ResolveWindow(InvoiceBulkRequestDto request)
        {
            var preset = ReportPeriod.ParsePreset(request.Preset);
            // A caller that sends explicit dates and no preset means a custom
            // window — asking them to send "custom" as well would be ceremony.
            if (preset == ReportDatePreset.AllPeriods
                && (request.DateFrom.HasValue || request.DateTo.HasValue))
                preset = ReportDatePreset.Custom;

            // Only the ORDERING is enforced, not ReportPeriod.Validate's
            // both-bounds rule: the Invoices screen has always allowed a
            // half-open date filter ("everything from 1 Aug"), and a bulk run
            // over the same filters must not refuse what the list accepts.
            // Both surfaces get this identical message.
            if (request.DateFrom.HasValue && request.DateTo.HasValue
                && request.DateFrom.Value.Date > request.DateTo.Value.Date)
                throw new InvalidOperationException("Start date must be on or before the end date.");

            return ReportPeriod.Resolve(preset, request.DateFrom, request.DateTo);
        }

        private static string NormalizeDocumentType(string? raw) =>
            string.Equals(raw?.Trim(), "Bill", StringComparison.OrdinalIgnoreCase) ? "Bill" : "TaxInvoice";

        private static string Label(string documentType) =>
            documentType == "TaxInvoice" ? "Sales Tax Invoice" : "Bill";
    }
}
