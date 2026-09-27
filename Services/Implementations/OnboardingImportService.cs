using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Helpers.Onboarding;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Previews and commits the onboarding workbook. The rules for a cell live
    /// in <see cref="OnboardingRowRules"/>; this class adds what needs the
    /// database — does the record already exist, is the HS code one FBR
    /// knows, which item does an opening-stock row mean — and then creates
    /// through the SAME services the forms use, so duplicate checks, HS
    /// validation, UOM enrichment, unit registration and client / supplier
    /// grouping cannot drift from them.
    ///
    /// Existing records are skipped, never changed. A bad row is reported and
    /// never stops the others. Commit re-reads the uploaded file rather than
    /// trusting anything the browser kept, so what was approved is what lands.
    /// </summary>
    public class OnboardingImportService : IOnboardingImportService
    {
        private readonly AppDbContext _db;
        private readonly IClientService _clients;
        private readonly ISupplierService _suppliers;
        private readonly IItemTypeService _itemTypes;
        private readonly IFbrService _fbr;
        private readonly IFbrLookupService _lookups;
        private readonly ILogger<OnboardingImportService> _logger;

        public OnboardingImportService(
            AppDbContext db,
            IClientService clients,
            ISupplierService suppliers,
            IItemTypeService itemTypes,
            IFbrService fbr,
            IFbrLookupService lookups,
            ILogger<OnboardingImportService> logger)
        {
            _db = db;
            _clients = clients;
            _suppliers = suppliers;
            _itemTypes = itemTypes;
            _fbr = fbr;
            _lookups = lookups;
            _logger = logger;
        }

        // ── Lookups ─────────────────────────────────────────────────────────

        private async Task<RuleContext> BuildRuleContextAsync()
        {
            var provinces = (await _lookups.GetByCategoryAsync("Province"))
                .Where(l => l.IsActive).OrderBy(l => l.SortOrder).ToList();
            var byLabel = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var p in provinces)
                if (int.TryParse(p.Code, out var code) && !byLabel.ContainsKey(p.Label.Trim()))
                    byLabel[p.Label.Trim()] = code;

            var regTypes = (await _lookups.GetByCategoryAsync("RegistrationType"))
                .Where(l => l.IsActive).OrderBy(l => l.SortOrder)
                .Select(l => l.Code.Trim()).Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (regTypes.Count == 0) regTypes = new List<string> { "Registered", "Unregistered", "FTN", "CNIC" };

            return new RuleContext(byLabel, regTypes);
        }

        public async Task<byte[]> BuildSampleAsync(int companyId, IReadOnlyList<string> sheets)
        {
            var ctx = await BuildRuleContextAsync();
            var units = await _db.Units.AsNoTracking()
                .Where(u => u.CompanyId == companyId)
                .OrderBy(u => u.Name).Select(u => u.Name).ToListAsync();
            var companyName = await _db.Companies.AsNoTracking()
                .Where(c => c.Id == companyId).Select(c => c.BrandName ?? c.Name).FirstOrDefaultAsync();
            return OnboardingSampleWorkbook.BuildSample(sheets,
                new SampleLists(ctx.ProvinceCodeByLabel.Keys.ToList(), ctx.RegistrationTypes.ToList(), units),
                companyName);
        }

        // ── Plan: what each row would do ────────────────────────────────────

        private static string NameKey(string? s) => (s ?? "").Trim().ToLowerInvariant();
        private static string ItemKey(string? name, string? hs) => NameKey(name) + "|" + (hs ?? "").Trim();

        private class PlannedRow
        {
            public ParsedRow Row = null!;
            public string Status = OnboardingRowStatus.Import;
            public string Label = "";
            public List<RowIssue> Issues = new();
            /// <summary>Opening stock: the existing item it names, or null when it is an item from this file.</summary>
            public int? ExistingItemTypeId;
            /// <summary>Opening stock: the ItemKey of the Items-sheet row it names.</summary>
            public string? FileItemKey;

            public void Refuse(string? column, string message)
            {
                Issues.Add(new RowIssue(column, message, true));
                Status = OnboardingRowStatus.Error;
            }
        }

        private class PlannedSheet
        {
            public OnboardingSheet Sheet = null!;
            public ParsedSheet Parsed = null!;
            public List<PlannedRow> Rows = new();
        }

        private class Plan
        {
            public RuleContext Context = null!;
            public List<PlannedSheet> Sheets = new();
            public PlannedSheet? Get(string key) => Sheets.FirstOrDefault(s => s.Sheet.Key == key);
        }

        private async Task<Plan> BuildPlanAsync(Stream file, string fileName, int companyId, IReadOnlyList<string> sheets)
        {
            var ext = Path.GetExtension(fileName ?? "");
            if (!WorkbookReaderFactory.IsSupported(ext))
                throw new OnboardingFileException("Only .xlsx or .xls files are supported.");

            Dictionary<string, ParsedSheet> parsed;
            try
            {
                using var ms = new MemoryStream();
                await file.CopyToAsync(ms);
                ms.Position = 0;
                using var wb = WorkbookReaderFactory.Open(ms, ext);
                parsed = OnboardingWorkbookReader.Read(wb, sheets);
            }
            catch (OnboardingFileException) { throw; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Onboarding workbook could not be read for company {CompanyId}", companyId);
                throw new OnboardingFileException("The file could not be read as a spreadsheet. Save it as .xlsx and try again.");
            }

            foreach (var p in parsed.Values.Where(p => p.DataRowCount > OnboardingSchema.MaxRowsPerSheet))
                throw new OnboardingFileException(
                    $"The {OnboardingSchema.Find(p.Key)!.Title} sheet has {p.DataRowCount:N0} rows. " +
                    $"At most {OnboardingSchema.MaxRowsPerSheet:N0} rows per sheet can be imported at once; split it into two files.");

            var plan = new Plan { Context = await BuildRuleContextAsync() };
            foreach (var key in OnboardingSheets.ImportOrder.Where(k => parsed.ContainsKey(k)))
            {
                var sheet = OnboardingSchema.Find(key)!;
                var ps = new PlannedSheet { Sheet = sheet, Parsed = parsed[key] };
                foreach (var row in ps.Parsed.Rows)
                {
                    var pr = new PlannedRow
                    {
                        Row = row,
                        Label = key == OnboardingSheets.OpeningStock ? row.Get("itemName") : row.Get("name"),
                        Issues = OnboardingRowRules.Check(key, row, plan.Context),
                    };
                    foreach (var missing in ps.Parsed.MissingHeadings)
                        pr.Issues.Add(new RowIssue(missing, "column not found in row 1", true));
                    pr.Status = pr.Issues.Any(i => i.IsError) ? OnboardingRowStatus.Error
                        : pr.Issues.Any() ? OnboardingRowStatus.Warning : OnboardingRowStatus.Import;
                    ps.Rows.Add(pr);
                }
                plan.Sheets.Add(ps);
            }

            await PlanPartiesAsync(plan.Get(OnboardingSheets.Customers), companyId, isCustomer: true);
            await PlanPartiesAsync(plan.Get(OnboardingSheets.Suppliers), companyId, isCustomer: false);
            var existingItems = await PlanItemsAsync(plan.Get(OnboardingSheets.Items), companyId);
            await PlanOpeningStockAsync(plan.Get(OnboardingSheets.OpeningStock), plan.Get(OnboardingSheets.Items),
                existingItems, companyId);
            return plan;
        }

        /// <summary>
        /// A first occurrence in the file wins; a later one with the same key
        /// is an error naming the row it repeats.
        /// </summary>
        private static void FlagInFileDuplicates(PlannedSheet ps, Func<PlannedRow, string?> keyOf, string column, string what)
        {
            var seen = new Dictionary<string, int>();
            foreach (var pr in ps.Rows)
            {
                var key = keyOf(pr);
                if (string.IsNullOrEmpty(key)) continue;
                if (seen.TryGetValue(key, out var first))
                {
                    if (pr.Status != OnboardingRowStatus.Error)
                        pr.Refuse(column, $"same {what} as row {first}");
                }
                else seen[key] = pr.Row.RowNumber;
            }
        }

        private async Task PlanPartiesAsync(PlannedSheet? ps, int companyId, bool isCustomer)
        {
            if (ps == null) return;
            var names = isCustomer
                ? await _db.Clients.AsNoTracking().Where(c => c.CompanyId == companyId).Select(c => c.Name).ToListAsync()
                : await _db.Suppliers.AsNoTracking().Where(s => s.CompanyId == companyId).Select(s => s.Name).ToListAsync();
            var existing = names.Select(NameKey).ToHashSet();
            var who = isCustomer ? "customer" : "supplier";

            foreach (var pr in ps.Rows.Where(r => r.Status != OnboardingRowStatus.Error))
                if (existing.Contains(NameKey(pr.Label)))
                {
                    pr.Status = OnboardingRowStatus.Exists;
                    pr.Issues.Add(new RowIssue("Name", $"a {who} with this name already exists, so this row is skipped", false));
                }

            FlagInFileDuplicates(ps, pr => pr.Status == OnboardingRowStatus.Exists ? null : NameKey(pr.Label), "Name", who);
        }

        private record ExistingItem(int Id, string Name, string? HsCode);

        private async Task<List<ExistingItem>> PlanItemsAsync(PlannedSheet? ps, int companyId)
        {
            // The catalog query filter already scopes ItemTypes to the route's
            // company ([AuthorizeCompany] sets it); the explicit CompanyId test
            // keeps this correct if that ever changes.
            var existing = await _db.ItemTypes.AsNoTracking()
                .Where(i => !i.IsDeleted && i.CompanyId == companyId)
                .Select(i => new ExistingItem(i.Id, i.Name, i.HSCode))
                .ToListAsync();
            if (ps == null) return existing;

            var keys = existing.Select(i => ItemKey(i.Name, i.HsCode)).ToHashSet();

            // Ask FBR's list once per distinct code, not once per row.
            var known = new Dictionary<string, bool>();
            foreach (var code in ps.Rows.Where(r => r.Status != OnboardingRowStatus.Error)
                         .Select(r => OnboardingRowRules.NormaliseHsCode(r.Row.Get("hsCode")))
                         .Where(c => c.Length > 0).Distinct())
            {
                try { known[code] = await _fbr.IsKnownHsCodeAsync(companyId, code); }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "HS code check failed for {HsCode}", code);
                    known[code] = true; // the create path re-checks and refuses on its own
                }
            }

            foreach (var pr in ps.Rows.Where(r => r.Status != OnboardingRowStatus.Error))
            {
                var hs = OnboardingRowRules.NormaliseHsCode(pr.Row.Get("hsCode"));
                if (hs.Length > 0 && known.TryGetValue(hs, out var ok) && !ok)
                {
                    pr.Refuse("HS Code", $"{hs} is not in FBR's HS code list");
                    continue;
                }
                if (keys.Contains(ItemKey(pr.Label, hs.Length == 0 ? null : hs)))
                {
                    pr.Status = OnboardingRowStatus.Exists;
                    pr.Issues.Add(new RowIssue("Item Name",
                        hs.Length == 0 ? "an item with this name and no HS code already exists, so this row is skipped"
                                       : $"an item with this name and HS code {hs} already exists, so this row is skipped", false));
                }
            }

            FlagInFileDuplicates(ps, pr => pr.Status == OnboardingRowStatus.Exists ? null
                : ItemKey(pr.Label, OnboardingRowRules.NormaliseHsCode(pr.Row.Get("hsCode"))), "Item Name", "item name and HS code");
            return existing;
        }

        private async Task PlanOpeningStockAsync(PlannedSheet? ps, PlannedSheet? items, List<ExistingItem> existingItems, int companyId)
        {
            if (ps == null) return;
            var withOpening = (await _db.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId).Select(o => o.ItemTypeId).ToListAsync()).ToHashSet();

            // Items this same file will create (only when the Items sheet is part of this import).
            var fileItems = items?.Rows.Where(r => OnboardingRowStatus.WillImport(r.Status))
                .Select(r => (Name: r.Label, Hs: OnboardingRowRules.NormaliseHsCode(r.Row.Get("hsCode"))))
                .ToList() ?? new();

            foreach (var pr in ps.Rows.Where(r => r.Status != OnboardingRowStatus.Error))
            {
                var name = NameKey(pr.Label);
                var hs = OnboardingRowRules.NormaliseHsCode(pr.Row.Get("hsCode"));
                bool Matches(string n, string? h) => NameKey(n) == name && (hs.Length == 0 || (h ?? "").Trim() == hs);

                var inCatalog = existingItems.Where(i => Matches(i.Name, i.HsCode)).ToList();
                var inFile = fileItems.Where(f => Matches(f.Name, f.Hs)).ToList();
                var total = inCatalog.Count + inFile.Count;

                if (total == 0)
                {
                    pr.Refuse("Item Name", hs.Length == 0
                        ? $"no item named \"{pr.Label}\". Add it to the Items sheet or to Item Types first"
                        : $"no item named \"{pr.Label}\" with HS code {hs}");
                    continue;
                }
                if (total > 1)
                {
                    pr.Refuse("HS Code", $"{total} items are named \"{pr.Label}\". Add the HS code to say which one");
                    continue;
                }

                if (inCatalog.Count == 1)
                {
                    pr.ExistingItemTypeId = inCatalog[0].Id;
                    if (withOpening.Contains(inCatalog[0].Id))
                    {
                        pr.Status = OnboardingRowStatus.Exists;
                        pr.Issues.Add(new RowIssue("Item Name", "this item already has an opening balance, so this row is skipped", false));
                    }
                }
                else
                {
                    pr.FileItemKey = ItemKey(inFile[0].Name, inFile[0].Hs.Length == 0 ? null : inFile[0].Hs);
                }
            }

            FlagInFileDuplicates(ps, pr => pr.Status == OnboardingRowStatus.Exists ? null
                : pr.ExistingItemTypeId?.ToString() ?? pr.FileItemKey, "Item Name", "item");
        }

        // ── Preview ─────────────────────────────────────────────────────────

        private static OnboardingRowDto ToDto(PlannedRow pr) => new()
        {
            RowNumber = pr.Row.RowNumber,
            Status = pr.Status,
            Label = pr.Label,
            Issues = pr.Issues.Select(i => new OnboardingIssueDto { Column = i.Column, Message = i.Message, IsError = i.IsError }).ToList(),
        };

        public async Task<OnboardingPreviewDto> PreviewAsync(Stream file, string fileName, int companyId, IReadOnlyList<string> sheets)
        {
            var plan = await BuildPlanAsync(file, fileName, companyId, sheets);
            var dto = new OnboardingPreviewDto();
            foreach (var ps in plan.Sheets)
            {
                dto.Sheets.Add(new OnboardingSheetPreviewDto
                {
                    Key = ps.Sheet.Key,
                    Title = ps.Sheet.Title,
                    Present = ps.Parsed.Present,
                    ToImport = ps.Rows.Count(r => r.Status == OnboardingRowStatus.Import),
                    WithWarnings = ps.Rows.Count(r => r.Status == OnboardingRowStatus.Warning),
                    Existing = ps.Rows.Count(r => r.Status == OnboardingRowStatus.Exists),
                    Errors = ps.Rows.Count(r => r.Status == OnboardingRowStatus.Error),
                    SheetWarnings = ps.Parsed.Warnings.ToList(),
                    Rows = ps.Rows.Select(ToDto).ToList(),
                });
            }
            dto.TotalToImport = dto.Sheets.Sum(s => s.ToImport + s.WithWarnings);
            return dto;
        }

        public async Task<byte[]> BuildFixListAsync(Stream file, string fileName, int companyId, IReadOnlyList<string> sheets)
        {
            var plan = await BuildPlanAsync(file, fileName, companyId, sheets);
            var fixSheets = plan.Sheets.Select(ps => new FixListSheet(ps.Sheet.Key,
                ps.Rows.Where(r => r.Status == OnboardingRowStatus.Error)
                    .Select(r => new FixListRow(r.Row.Values,
                        string.Join("; ", r.Issues.Where(i => i.IsError).Select(i => i.Column == null ? i.Message : $"{i.Column}: {i.Message}"))))
                    .ToList()));
            return OnboardingSampleWorkbook.BuildFixList(fixSheets);
        }

        // ── Commit ──────────────────────────────────────────────────────────

        private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        public async Task<OnboardingCommitResultDto> CommitAsync(Stream file, string fileName, int companyId,
            IReadOnlyList<string> sheets, string? userName)
        {
            var plan = await BuildPlanAsync(file, fileName, companyId, sheets);
            var result = new OnboardingCommitResultDto();
            var createdItemIds = new Dictionary<string, int>();

            foreach (var ps in plan.Sheets)
            {
                var sr = new OnboardingSheetResultDto { Key = ps.Sheet.Key, Title = ps.Sheet.Title };
                foreach (var pr in ps.Rows)
                {
                    if (!OnboardingRowStatus.WillImport(pr.Status)) { sr.Skipped++; continue; }
                    try
                    {
                        await CreateAsync(ps.Sheet.Key, pr, companyId, plan.Context, createdItemIds);
                        sr.Created++;
                    }
                    catch (InvalidOperationException ex)
                    {
                        // The create services speak to the operator in their
                        // InvalidOperationException messages ("already exists",
                        // "HS code not recognised"); those are safe to show.
                        Fail(sr, pr, ex.Message);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Onboarding import: {Sheet} row {Row} failed for company {CompanyId}",
                            ps.Sheet.Key, pr.Row.RowNumber, companyId);
                        Fail(sr, pr, "could not be saved");
                    }
                }
                result.Sheets.Add(sr);
            }
            result.TotalCreated = result.Sheets.Sum(s => s.Created);
            return result;
        }

        private void Fail(OnboardingSheetResultDto sr, PlannedRow pr, string message)
        {
            // A failed save leaves its entity tracked; clearing stops the next
            // row's SaveChanges from retrying it. Every create is independent.
            _db.ChangeTracker.Clear();
            sr.Failed++;
            var dto = ToDto(pr);
            dto.Status = OnboardingRowStatus.Error;
            dto.Issues.Add(new OnboardingIssueDto { Message = message, IsError = true });
            sr.FailedRows.Add(dto);
        }

        private async Task CreateAsync(string sheetKey, PlannedRow pr, int companyId, RuleContext ctx,
            Dictionary<string, int> createdItemIds)
        {
            var row = pr.Row;
            switch (sheetKey)
            {
                case OnboardingSheets.Customers:
                {
                    var type = OnboardingRowRules.ResolveRegistrationType(row.Get("registrationType"), ctx.RegistrationTypes);
                    await _clients.CreateAsync(new ClientDto
                    {
                        CompanyId = companyId,
                        Name = row.Get("name").Trim(),
                        RegistrationType = type,
                        NTN = OnboardingRowRules.NormaliseNtn(row.Get("ntn")),
                        CNIC = Blank(OnboardingRowRules.DigitsOnly(row.Get("cnic"))),
                        FbrProvinceCode = OnboardingRowRules.ResolveProvince(row.Get("province"), ctx.ProvinceCodeByLabel),
                        Address = Blank(row.Get("address")),
                        STRN = string.Equals(type, "Registered", StringComparison.OrdinalIgnoreCase) ? Blank(row.Get("strn")) : null,
                        Phone = Blank(row.Get("phone")),
                        Site = Blank(JoinList(row.Get("sites"))),
                        ContactPerson = Blank(JoinList(row.Get("contactPerson"))),
                    });
                    break;
                }
                case OnboardingSheets.Suppliers:
                {
                    var type = OnboardingRowRules.ResolveRegistrationType(row.Get("registrationType"), ctx.RegistrationTypes);
                    await _suppliers.CreateAsync(new SupplierDto
                    {
                        CompanyId = companyId,
                        Name = row.Get("name").Trim(),
                        RegistrationType = type,
                        NTN = OnboardingRowRules.NormaliseNtn(row.Get("ntn")),
                        CNIC = Blank(OnboardingRowRules.DigitsOnly(row.Get("cnic"))),
                        FbrProvinceCode = OnboardingRowRules.ResolveProvince(row.Get("province"), ctx.ProvinceCodeByLabel),
                        Address = Blank(row.Get("address")),
                        STRN = string.Equals(type, "Registered", StringComparison.OrdinalIgnoreCase) ? Blank(row.Get("strn")) : null,
                        Phone = Blank(row.Get("phone")),
                    });
                    break;
                }
                case OnboardingSheets.Items:
                {
                    var hs = Blank(OnboardingRowRules.NormaliseHsCode(row.Get("hsCode")));
                    var created = await _itemTypes.CreateAsync(new ItemTypeDto
                    {
                        Name = row.Get("name").Trim(),
                        HSCode = hs,
                        UOM = Blank(row.Get("unit")),
                        SaleType = OnboardingRowRules.ResolveSaleType(row.Get("saleType")),
                        // The Item Type form's own default; it also confirms the
                        // name, as the form does, past the near-duplicate guard.
                        IsFavorite = true,
                    }, companyId);
                    createdItemIds[ItemKey(created.Name, created.HSCode)] = created.Id;
                    break;
                }
                case OnboardingSheets.OpeningStock:
                {
                    int itemTypeId;
                    if (pr.ExistingItemTypeId is int existing) itemTypeId = existing;
                    else if (pr.FileItemKey != null && createdItemIds.TryGetValue(pr.FileItemKey, out var fromFile)) itemTypeId = fromFile;
                    else throw new InvalidOperationException("its item was not created, so there is nothing to hold the stock");

                    if (await _db.OpeningStockBalances.AnyAsync(o => o.CompanyId == companyId && o.ItemTypeId == itemTypeId))
                        throw new InvalidOperationException("this item already has an opening balance");

                    _db.OpeningStockBalances.Add(new OpeningStockBalance
                    {
                        CompanyId = companyId,
                        ItemTypeId = itemTypeId,
                        Quantity = OnboardingRowRules.ParseQuantity(row.Get("quantity"))!.Value,
                        AsOfDate = OnboardingRowRules.ParseDate(row.Get("asOfDate"))!.Value,
                        Notes = Blank(row.Get("notes")),
                        CreatedAt = DateTime.UtcNow,
                    });
                    await _db.SaveChangesAsync();
                    break;
                }
            }
        }

        /// <summary>"Karachi ;Lahore;; " -> "Karachi;Lahore", the stored shape of Site / ContactPerson.</summary>
        private static string JoinList(string raw) =>
            string.Join(";", (raw ?? "").Split(';').Select(s => s.Trim()).Where(s => s.Length > 0));
    }
}
