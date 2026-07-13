using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Manager.io → MyApp ETL (see <see cref="IManagerImportService"/>). Mirrors
    /// the LegacyImport conventions: ExternalRef idempotency (mgr-* keys),
    /// masters → documents → money order, GL-anchored authoritative totals from
    /// the Manager list view (GrandTotal = invoiceAmount; AmountPaid = total −
    /// balanceDue so AR/AP match Manager exactly). Notes are AR-neutral. GL
    /// journals/transfers are intentionally NOT imported (Manager exposes no
    /// account classification; MyApp derives the GL from documents instead).
    /// </summary>
    public partial class ManagerImportService : IManagerImportService
    {
        private readonly AppDbContext _db;
        private readonly ILogger<ManagerImportService>? _logger;

        public ManagerImportService(AppDbContext db, ILogger<ManagerImportService>? logger = null)
        {
            _db = db;
            _logger = logger;
        }

        // ── JSON helpers (static; operate on the parsed elements) ───────────────
        private static string? Str(JsonElement e, string p) =>
            e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        private static decimal Money(JsonElement e, string p)
        {
            if (!e.TryGetProperty(p, out var v)) return 0m;
            if (v.ValueKind == JsonValueKind.Number) return v.GetDecimal();
            if (v.ValueKind == JsonValueKind.Object && v.TryGetProperty("value", out var val) && val.ValueKind == JsonValueKind.Number) return val.GetDecimal();
            return 0m;
        }
        private static DateTime? Date(JsonElement e, string p) =>
            DateTime.TryParse(Str(e, p), CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
        private static int RefNum(JsonElement e, string p = "Reference") =>
            int.TryParse(Str(e, p)?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;
        private static string Uom(JsonElement line)
        {
            if (line.TryGetProperty("CustomFields", out var cf) && cf.ValueKind == JsonValueKind.Object)
                foreach (var prop in cf.EnumerateObject())
                    if (prop.Value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(prop.Value.GetString()))
                        return prop.Value.GetString()!.Trim();
            return "";
        }
        private static (string? addr, string? ntn, string? strn) ParseAddr(string? billing)
        {
            if (string.IsNullOrWhiteSpace(billing)) return (null, null, null);
            string? ntn = null, strn = null; var addrLines = new List<string>();
            foreach (var raw in billing.Replace("\r", "").Split('\n'))
            {
                var line = raw.Trim();
                if (line.Length == 0) continue;
                var upper = line.ToUpperInvariant();
                string? After() { var i = line.IndexOf(':'); return i >= 0 ? line[(i + 1)..].Trim() : null; }
                if (upper.StartsWith("NTN")) ntn ??= After();
                else if (upper.StartsWith("STRN") || upper.StartsWith("STN") || upper.StartsWith("GST") || upper.StartsWith("S.TAX")) strn ??= After();
                else addrLines.Add(line.StartsWith("Address:", StringComparison.OrdinalIgnoreCase) ? line["Address:".Length..].Trim() : line);
            }
            var addr = addrLines.Count > 0 ? string.Join(", ", addrLines) : null;
            return (addr, string.IsNullOrWhiteSpace(ntn) ? null : ntn, string.IsNullOrWhiteSpace(strn) ? null : strn);
        }

        public async Task<ManagerImportReport> RunAsync(
            IReadOnlyDictionary<string, JsonDocument> summaryDocs,
            IReadOnlyDictionary<string, JsonDocument> detailDocs,
            string? companyName, int? targetCompanyId, bool dryRun, bool fresh, int? callerUserId)
        {
            if (targetCompanyId == null && string.IsNullOrWhiteSpace(companyName))
                throw new InvalidOperationException("Provide an existing companyId or a new companyName.");
            if (detailDocs.Count == 0) throw new InvalidOperationException("No detail JSON found in the upload (expected detail/*.json).");

            IEnumerable<JsonElement> Rows(string entity, bool detail)
            {
                var map = detail ? detailDocs : summaryDocs;
                return map.TryGetValue(entity, out var doc) && doc.RootElement.ValueKind == JsonValueKind.Array
                    ? doc.RootElement.EnumerateArray() : Enumerable.Empty<JsonElement>();
            }

            // per-scope document-number allocator (preserve numeric Reference where free)
            var usedNums = new Dictionary<string, HashSet<int>>();
            var maxNums = new Dictionary<string, int>();
            int Alloc(string scope, int desired, bool unique = true)
            {
                var used = usedNums.TryGetValue(scope, out var s) ? s : (usedNums[scope] = new HashSet<int>());
                if (!unique) { if (desired > 0) return desired; }
                int n;
                if (desired > 0 && !used.Contains(desired)) n = desired;
                else { n = Math.Max(maxNums.GetValueOrDefault(scope), desired) + 1; while (used.Contains(n)) n++; }
                used.Add(n);
                if (n > maxNums.GetValueOrDefault(scope)) maxNums[scope] = n;
                return n;
            }

            var report = new ManagerImportReport { CompanyName = companyName, DryRun = dryRun };
            void Note(string s) => report.Notes.Add(s);

            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                // ── Company: target an existing one by id, or find/create by name ─
                async Task<bool> HasDataAsync(int id) =>
                    await _db.Invoices.AnyAsync(i => i.CompanyId == id) || await _db.Clients.AnyAsync(c => c.CompanyId == id);

                Company company;
                if (targetCompanyId is int existingId)
                {
                    company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == existingId)
                        ?? throw new InvalidOperationException($"Company {existingId} not found.");
                    if (await HasDataAsync(company.Id))
                    {
                        if (!fresh) throw new InvalidOperationException($"Company \"{company.Name}\" (id {company.Id}) already has data. Tick 'Fresh' to wipe & reload.");
                        await WipeCompanyAsync(company.Id); Note($"fresh: wiped existing data for company id={company.Id}");
                    }
                }
                else
                {
                    company = await _db.Companies.FirstOrDefaultAsync(c => c.Name == companyName);
                    if (company != null)
                    {
                        if (await HasDataAsync(company.Id))
                        {
                            if (!fresh) throw new InvalidOperationException($"Company \"{companyName}\" already has data. Tick 'Fresh' to wipe & reload.");
                            await WipeCompanyAsync(company.Id); Note($"fresh: wiped existing data for company id={company.Id}");
                        }
                    }
                    else
                    {
                        company = new Company
                        {
                            Name = companyName!.Trim(),
                            FbrEnabled = false,
                            IsTenantIsolated = true,           // real isolation on shared/live servers
                            InventoryTrackingEnabled = false,  // Manager has no inventory module in use
                        };
                        _db.Companies.Add(company);
                        await _db.SaveChangesAsync();
                    }
                }
                int companyId = company.Id;
                report.CompanyId = companyId;
                report.CompanyName = company.Name;

                // Grant the operator access (seed admin sees all regardless). Do NOT
                // auto-grant every user — on a multi-tenant/live server that would
                // leak the new company to unrelated tenants' operators.
                if (callerUserId is int uid && uid > 0
                    && !await _db.UserCompanies.AnyAsync(u => u.CompanyId == companyId && u.UserId == uid))
                {
                    _db.UserCompanies.Add(new UserCompany { UserId = uid, CompanyId = companyId });
                    await _db.SaveChangesAsync();
                }

                // ── Divisions ────────────────────────────────────────────────────
                var divIdByGuid = new Dictionary<string, int>();
                var divIdByName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                int newDivs = 0;
                foreach (var d in Rows("divisions", false))
                {
                    var key = Str(d, "key")!; var name = (Str(d, "name") ?? "Division").Trim();
                    var existing = await _db.Divisions.FirstOrDefaultAsync(x => x.CompanyId == companyId && x.Name == name);
                    if (existing == null) { existing = new Division { CompanyId = companyId, Name = name }; _db.Divisions.Add(existing); await _db.SaveChangesAsync(); newDivs++; }
                    divIdByGuid[key] = existing.Id; divIdByName[name] = existing.Id;
                }
                report.Created["divisions"] = newDivs;

                // ── Parties ──────────────────────────────────────────────────────
                var clientIdByGuid = new Dictionary<string, int>();
                var supplierIdByGuid = new Dictionary<string, int>();
                int newClients = 0, newSuppliers = 0;
                foreach (var c in Rows("customers", true))
                {
                    var key = Str(c, "Key") ?? Str(c, "id")!;
                    var (addr, ntn, strn) = ParseAddr(Str(c, "BillingAddress") ?? Str(c, "DefaultBillingAddress"));
                    _db.Clients.Add(new Client { CompanyId = companyId, Name = (Str(c, "Name") ?? "(unnamed)").Trim(), Address = addr, NTN = ntn, STRN = strn, ExternalRef = $"mgr-cust:{key}" });
                    newClients++;
                }
                await _db.SaveChangesAsync();
                foreach (var row in _db.Clients.Local.Where(c => c.CompanyId == companyId))
                    if (row.ExternalRef?.StartsWith("mgr-cust:") == true) clientIdByGuid[row.ExternalRef["mgr-cust:".Length..]] = row.Id;
                foreach (var s in Rows("suppliers", true))
                {
                    var key = Str(s, "Key") ?? Str(s, "id")!;
                    var (addr, ntn, strn) = ParseAddr(Str(s, "BillingAddress") ?? Str(s, "DefaultBillingAddress"));
                    _db.Suppliers.Add(new Supplier { CompanyId = companyId, Name = (Str(s, "Name") ?? "(unnamed)").Trim(), Address = addr, NTN = ntn, STRN = strn, ExternalRef = $"mgr-supp:{key}" });
                    newSuppliers++;
                }
                await _db.SaveChangesAsync();
                foreach (var row in _db.Suppliers.Local.Where(s => s.CompanyId == companyId))
                    if (row.ExternalRef?.StartsWith("mgr-supp:") == true) supplierIdByGuid[row.ExternalRef["mgr-supp:".Length..]] = row.Id;
                report.Created["clients"] = newClients; report.Created["suppliers"] = newSuppliers;

                var invAmountByGuid = Rows("sales-invoices", false).ToDictionary(e => Str(e, "key")!, e => (total: Money(e, "invoiceAmount"), balance: Money(e, "balanceDue")));
                var billAmountByGuid = Rows("purchase-invoices", false).ToDictionary(e => Str(e, "key")!, e => (total: Money(e, "invoiceAmount"), balance: Money(e, "balanceDue")));

                int? DivFromLines(JsonElement doc)
                {
                    if (doc.TryGetProperty("Lines", out var lines) && lines.ValueKind == JsonValueKind.Array)
                        foreach (var ln in lines.EnumerateArray())
                        { var g = Str(ln, "Division"); if (g != null && divIdByGuid.TryGetValue(g, out var id)) return id; }
                    if (doc.TryGetProperty("CustomFields", out var cf) && cf.ValueKind == JsonValueKind.Object)
                        foreach (var p in cf.EnumerateObject())
                            if (p.Value.ValueKind == JsonValueKind.String && divIdByName.TryGetValue(p.Value.GetString()!.Trim(), out var id)) return id;
                    return null;
                }
                (decimal qty, decimal price, string desc, string uom) Line(JsonElement ln, string priceProp)
                    => (ln.TryGetProperty("Qty", out var q) && q.ValueKind == JsonValueKind.Number ? q.GetDecimal() : 0m,
                        Money(ln, priceProp), (Str(ln, "LineDescription") ?? "").Trim(), Uom(ln));

                // ── Sales quotes / orders / delivery notes ──────────────────────
                int nQuote = 0;
                foreach (var h in Rows("sales-quotes", true))
                {
                    if (Str(h, "Customer") is not { } cust || !clientIdByGuid.TryGetValue(cust, out var clientId)) continue;
                    int num = Alloc("quote:0", RefNum(h));
                    var items = new List<SalesQuoteItem>();
                    if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
                        foreach (var ln in L.EnumerateArray()) { var (qq, pp, dd, uu) = Line(ln, "SalesUnitPrice"); items.Add(new SalesQuoteItem { Description = dd, Quantity = qq, Unit = uu, UnitPrice = pp, LineTotal = Math.Round(qq * pp, 2) }); }
                    var sub = items.Sum(i => i.LineTotal);
                    _db.SalesQuotes.Add(new SalesQuote { CompanyId = companyId, DivisionId = null, ClientId = clientId, QuoteNumber = num, Date = Date(h, "IssueDate") ?? DateTime.Today, Subtotal = sub, GSTRate = 0, GSTAmount = 0, GrandTotal = sub, AmountInWords = "", Status = "Sent", Items = items });
                    nQuote++;
                }
                await _db.SaveChangesAsync(); _db.ChangeTracker.Clear();
                report.Created["salesQuotes"] = nQuote;

                int nSo = 0;
                foreach (var h in Rows("sales-orders", true))
                {
                    if (Str(h, "Customer") is not { } cust || !clientIdByGuid.TryGetValue(cust, out var clientId)) continue;
                    int num = Alloc("so:0", RefNum(h));
                    var items = new List<SalesOrderItem>();
                    if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
                        foreach (var ln in L.EnumerateArray()) { var (qq, _, dd, uu) = Line(ln, "SalesUnitPrice"); items.Add(new SalesOrderItem { Description = dd, Quantity = qq, Unit = uu }); }
                    _db.SalesOrders.Add(new SalesOrder { CompanyId = companyId, DivisionId = null, ClientId = clientId, SalesOrderNumber = num, OrderDate = Date(h, "IssueDate") ?? DateTime.Today, Status = "Open", IsImported = true, Items = items });
                    nSo++;
                }
                await _db.SaveChangesAsync(); _db.ChangeTracker.Clear();
                report.Created["salesOrders"] = nSo;

                int nDc = 0;
                foreach (var h in Rows("delivery-notes", true))
                {
                    if (Str(h, "Customer") is not { } cust || !clientIdByGuid.TryGetValue(cust, out var clientId)) continue;
                    int num = Alloc("dc:0", RefNum(h), unique: false);
                    var items = new List<DeliveryItem>();
                    if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
                        foreach (var ln in L.EnumerateArray()) { var (qq, _, dd, uu) = Line(ln, "SalesUnitPrice"); items.Add(new DeliveryItem { Description = dd, Quantity = qq, Unit = uu }); }
                    _db.DeliveryChallans.Add(new DeliveryChallan { CompanyId = companyId, DivisionId = null, ClientId = clientId, ChallanNumber = num, PoNumber = "", DeliveryDate = Date(h, "DeliveryDate"), Status = "Imported", IsImported = true, Items = items });
                    nDc++;
                }
                await _db.SaveChangesAsync(); _db.ChangeTracker.Clear();
                report.Created["deliveryChallans"] = nDc;

                // ── Sales invoices ──────────────────────────────────────────────
                var invoiceIdByGuid = new Dictionary<string, int>();
                int nInv = 0;
                foreach (var h in Rows("sales-invoices", true))
                {
                    var key = Str(h, "Key") ?? Str(h, "id")!;
                    if (Str(h, "Customer") is not { } cust || !clientIdByGuid.TryGetValue(cust, out var clientId)) continue;
                    int? divId = DivFromLines(h);
                    int num = Alloc($"inv:{divId ?? 0}", RefNum(h));
                    var total = invAmountByGuid.TryGetValue(key, out var m) ? m.total : 0m;
                    var items = new List<InvoiceItem>();
                    if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
                        foreach (var ln in L.EnumerateArray()) { var (qq, pp, dd, uu) = Line(ln, "SalesUnitPrice"); items.Add(new InvoiceItem { Description = dd, Quantity = qq, UOM = uu, UnitPrice = pp, LineTotal = Math.Round(qq * pp, 2) }); }
                    if (total <= 0) total = items.Sum(i => i.LineTotal);
                    _db.Invoices.Add(new Invoice { CompanyId = companyId, ClientId = clientId, DivisionId = divId, InvoiceNumber = num, Date = Date(h, "IssueDate") ?? DateTime.Today, Subtotal = total, GSTRate = 0, GSTAmount = 0, GrandTotal = total, AmountInWords = "", IsMigrated = true, IsFbrExcluded = true, ExternalRef = $"mgr-sinv:{key}", Items = items });
                    nInv++;
                }
                await _db.SaveChangesAsync();
                foreach (var inv in _db.Invoices.Local.Where(i => i.CompanyId == companyId))
                    if (inv.ExternalRef?.StartsWith("mgr-sinv:") == true) invoiceIdByGuid[inv.ExternalRef["mgr-sinv:".Length..]] = inv.Id;
                _db.ChangeTracker.Clear();
                report.Created["salesInvoices"] = nInv;

                // ── Purchase bills ──────────────────────────────────────────────
                var billIdByGuid = new Dictionary<string, int>();
                int nBill = 0;
                foreach (var h in Rows("purchase-invoices", true))
                {
                    var key = Str(h, "Key") ?? Str(h, "id")!;
                    if (Str(h, "Supplier") is not { } supp || !supplierIdByGuid.TryGetValue(supp, out var supplierId)) continue;
                    int num = Alloc("bill:0", RefNum(h));
                    var total = billAmountByGuid.TryGetValue(key, out var m) ? m.total : 0m;
                    var items = new List<PurchaseItem>();
                    if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
                        foreach (var ln in L.EnumerateArray()) { var (qq, pp, dd, uu) = Line(ln, "PurchaseUnitPrice"); items.Add(new PurchaseItem { Description = dd, Quantity = qq, UOM = uu, UnitPrice = pp, LineTotal = Math.Round(qq * pp, 2) }); }
                    if (total <= 0) total = items.Sum(i => i.LineTotal);
                    _db.PurchaseBills.Add(new PurchaseBill { CompanyId = companyId, SupplierId = supplierId, PurchaseBillNumber = num, Date = Date(h, "IssueDate") ?? DateTime.Today, Subtotal = total, GSTRate = 0, GSTAmount = 0, GrandTotal = total, AmountInWords = "", IsMigrated = true, ExternalRef = $"mgr-pinv:{key}", Items = items });
                    nBill++;
                }
                await _db.SaveChangesAsync();
                foreach (var b in _db.PurchaseBills.Local.Where(p => p.CompanyId == companyId))
                    if (b.ExternalRef?.StartsWith("mgr-pinv:") == true) billIdByGuid[b.ExternalRef["mgr-pinv:".Length..]] = b.Id;
                _db.ChangeTracker.Clear();
                report.Created["purchaseBills"] = nBill;

                // ── Credit / Debit notes (AR-neutral: AmountPaid = GrandTotal) ───
                int nCn = 0, nDn = 0, noteNoClient = 0;
                async Task ImportNotes(string entity, int docType, string erPrefix)
                {
                    int made = 0;
                    foreach (var h in Rows(entity, true))
                    {
                        var key = Str(h, "Key") ?? Str(h, "id")!;
                        if (Str(h, "Customer") is not { } cust || !clientIdByGuid.TryGetValue(cust, out var clientId)) { noteNoClient++; continue; }
                        int? divId = DivFromLines(h);
                        int? origId = Str(h, "SalesInvoice") is { } og && invoiceIdByGuid.TryGetValue(og, out var oid) ? oid : (int?)null;
                        int num = Alloc($"note:{docType}:{divId ?? 0}", RefNum(h));
                        var items = new List<InvoiceItem>();
                        if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
                            foreach (var ln in L.EnumerateArray()) { var (qq, pp, dd, uu) = Line(ln, "SalesUnitPrice"); var q = qq <= 0 ? 1m : qq; items.Add(new InvoiceItem { Description = dd, Quantity = q, UOM = uu, UnitPrice = pp, LineTotal = Math.Round(q * pp, 2) }); }
                        var total = items.Sum(i => i.LineTotal);
                        _db.Invoices.Add(new Invoice { CompanyId = companyId, ClientId = clientId, DivisionId = divId, InvoiceNumber = num, Date = Date(h, "IssueDate") ?? DateTime.Today, Subtotal = total, GSTRate = 0, GSTAmount = 0, GrandTotal = total, AmountPaid = total, AmountInWords = "", DocumentType = docType, OriginalInvoiceId = origId, IsMigrated = true, IsFbrExcluded = true, ExternalRef = $"{erPrefix}{key}", Items = items });
                        made++;
                    }
                    await _db.SaveChangesAsync(); _db.ChangeTracker.Clear();
                    if (docType == 10) nCn = made; else nDn = made;
                }
                await ImportNotes("credit-notes", 10, "mgr-scn:");
                await ImportNotes("debit-notes", 9, "mgr-sdn:");
                report.Created["creditNotes"] = nCn; report.Created["debitNotes"] = nDn;
                if (noteNoClient > 0) Note($"Skipped {noteNoClient} note(s) with no resolvable customer.");

                // ── Withholding-tax receipts ────────────────────────────────────
                int nWht = 0, whtNoClient = 0, whtSeq = 0;
                foreach (var h in Rows("withholding-tax-receipts", true))
                {
                    if (Str(h, "Customer") is not { } cust || !clientIdByGuid.TryGetValue(cust, out var clientId)) { whtNoClient++; continue; }
                    whtSeq++;
                    _db.WithholdingTaxReceipts.Add(new WithholdingTaxReceipt { CompanyId = companyId, DivisionId = null, ReceiptNumber = whtSeq, ClientId = clientId, Date = Date(h, "Date") ?? DateTime.Today, Amount = Money(h, "Amount"), Description = null });
                    nWht++;
                }
                await _db.SaveChangesAsync(); _db.ChangeTracker.Clear();
                report.Created["withholdingTaxReceipts"] = nWht;
                if (whtNoClient > 0) Note($"Skipped {whtNoClient} WHT receipt(s) with no resolvable customer.");

                // ── Receipts / Payments (cash ledger + allocations) ─────────────
                var bankNameByGuid = Rows("bank-and-cash-accounts", false).ToDictionary(e => Str(e, "key")!, e => Str(e, "name") ?? "");
                var (nRcp, rcpUn) = await ImportMoneyAsync(companyId, PaymentDirection.Receipt, Rows("receipts", true), null, clientIdByGuid, "Client", "ReceivedIn", bankNameByGuid, "AccountsReceivableSalesInvoice", invoiceIdByGuid, Alloc);
                report.Created["receipts"] = nRcp;
                if (rcpUn > 0) Note($"Receipts: {rcpUn:N0} PKR on-account (not doc-linked).");
                var (nPmt, pmtUn) = await ImportMoneyAsync(companyId, PaymentDirection.Payment, Rows("payments", true), "Supplier", supplierIdByGuid, "Supplier", "PaidFrom", bankNameByGuid, "PurchaseInvoice", billIdByGuid, Alloc);
                report.Created["payments"] = nPmt;
                if (pmtUn > 0) Note($"Payments: {pmtUn:N0} PKR on-account (not doc-linked).");

                // ── Anchor AmountPaid to Manager balanceDue (exact AR/AP) ───────
                int invPaid = 0, billPaid = 0;
                foreach (var inv in await _db.Invoices.Where(i => i.CompanyId == companyId && i.ExternalRef != null).ToListAsync())
                {
                    var key = inv.ExternalRef!.StartsWith("mgr-sinv:") ? inv.ExternalRef!["mgr-sinv:".Length..] : null;
                    if (key != null && invAmountByGuid.TryGetValue(key, out var m)) { inv.AmountPaid = m.total - m.balance; invPaid++; }
                }
                foreach (var b in await _db.PurchaseBills.Where(p => p.CompanyId == companyId && p.ExternalRef != null).ToListAsync())
                {
                    var key = b.ExternalRef!.StartsWith("mgr-pinv:") ? b.ExternalRef!["mgr-pinv:".Length..] : null;
                    if (key != null && billAmountByGuid.TryGetValue(key, out var m)) { b.AmountPaid = m.total - m.balance; billPaid++; }
                }
                await _db.SaveChangesAsync();

                // ── Seed next document numbers (company + per division) ─────────
                // So the config screens don't show 0 and the next created document
                // continues the imported sequence. Starting = max+1, Current = max
                // (only raises). Scoped exactly as imported: invoices & notes are
                // division-tagged; quotes/orders/challans/bills are company-level.
                await SeedStartingNumbersAsync(companyId);
                report.Notes.Add("Seeded next document numbers (Starting = imported max + 1) on the company and each division.");

                // ── Reconciliation ──────────────────────────────────────────────
                report.ArManager = invAmountByGuid.Values.Sum(v => v.balance);
                report.ApManager = billAmountByGuid.Values.Sum(v => v.balance);
                report.SalesTotal = await _db.Invoices.Where(i => i.CompanyId == companyId && i.DocumentType != 9 && i.DocumentType != 10).SumAsync(i => (decimal?)i.GrandTotal) ?? 0m;
                report.ArMyApp = await _db.Invoices.Where(i => i.CompanyId == companyId && i.DocumentType != 9 && i.DocumentType != 10).SumAsync(i => (decimal?)(i.GrandTotal - i.AmountPaid)) ?? 0m;
                report.ApMyApp = await _db.PurchaseBills.Where(p => p.CompanyId == companyId).SumAsync(p => (decimal?)(p.GrandTotal - p.AmountPaid)) ?? 0m;
                Note("GL journals / inter-account transfers NOT imported (Manager exposes no account classification; enable MyApp's GL posting engine to derive the ledger from documents).");

                if (dryRun) { await tx.RollbackAsync(); Note("DRY RUN — rolled back, nothing persisted."); }
                else { await tx.CommitAsync(); }
                return report;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        // Generic money-document importer (receipt/payment).
        private async Task<(int created, decimal unallocated)> ImportMoneyAsync(
            int companyId, PaymentDirection dir, IEnumerable<JsonElement> rows,
            string? contactGuidProp, Dictionary<string, int> contactMap, string contactType,
            string bankProp, Dictionary<string, string> bankNameByGuid,
            string lineDocProp, Dictionary<string, int> docMap, Func<string, int, bool, int> alloc)
        {
            int created = 0; decimal unallocated = 0m;
            bool isReceipt = dir == PaymentDirection.Receipt;
            foreach (var h in rows)
            {
                int contactId = 0;
                if (contactGuidProp != null && Str(h, contactGuidProp) is { } cg && contactMap.TryGetValue(cg, out var ci)) contactId = ci;
                var allocs = new List<PaymentAllocation>();
                decimal amount = 0m, lineUnalloc = 0m;
                if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
                    foreach (var ln in L.EnumerateArray())
                    {
                        var amt = Money(ln, "Amount"); amount += amt;
                        if (contactId == 0 && Str(ln, "AccountsReceivableCustomer") is { } custG && contactMap.TryGetValue(custG, out var lc)) contactId = lc;
                        if (Str(ln, lineDocProp) is { } docG && docMap.TryGetValue(docG, out var docId) && amt > 0)
                            allocs.Add(new PaymentAllocation { InvoiceId = isReceipt ? docId : (int?)null, PurchaseBillId = isReceipt ? (int?)null : docId, Amount = amt });
                        else lineUnalloc += amt;
                    }
                if (amount <= 0) continue;
                int num = alloc($"pay:{(int)dir}", RefNum(h), true);
                var bankG = Str(h, bankProp);
                _db.Payments.Add(new Payment
                {
                    CompanyId = companyId, Direction = dir, Number = num, Date = Date(h, "Date") ?? DateTime.Today,
                    ContactType = contactId != 0 ? contactType : "Other", ContactId = contactId != 0 ? contactId : (int?)null,
                    BankAccountName = bankG != null ? bankNameByGuid.GetValueOrDefault(bankG) : null,
                    Method = "Cash", Description = Str(h, "Description"), Amount = amount, Allocations = allocs,
                });
                created++; unallocated += lineUnalloc;
            }
            await _db.SaveChangesAsync(); _db.ChangeTracker.Clear();
            return (created, unallocated);
        }

        // Manager rolls its individual Bank & Cash Accounts up into one asset
        // line on the balance sheet / trial balance. These are the labels that
        // line uses (case-insensitive); the primary match is by amount (the
        // bank/cash balances sum to the roll-up), this is only the fallback.
        private static readonly HashSet<string> CashRollupNames = new(StringComparer.OrdinalIgnoreCase)
        { "Cash & cash equivalents", "Cash and cash equivalents", "Cash and cash equivalent", "Cash and bank" };

        // ── Trial Balance → chart of accounts opening balances ──────────────────
        public async Task<ManagerImportReport> ImportTrialBalanceAsync(
            int companyId, string trialBalanceText, bool dryRun,
            IReadOnlyDictionary<string, JsonDocument>? summaryDocs = null)
        {
            var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId)
                ?? throw new InvalidOperationException($"Company {companyId} not found.");
            var report = new ManagerImportReport { CompanyId = companyId, CompanyName = company.Name, DryRun = dryRun };

            var rows = ParseTrialBalance(trialBalanceText);
            if (rows.Count == 0) throw new InvalidOperationException("No accounts parsed from the trial balance (expected a Manager tab-separated Trial Balance export).");

            // Un-bake Retained earnings: a Manager Trial Balance carries RE
            // INCLUSIVE of the current period's net profit. MyApp's balance sheet
            // now shows that profit as a computed "Current-Year Earnings" equity
            // line (AccountService.GetTreeAsync), so the stored RE must hold only
            // the STARTING value or equity would double-count. new RE = TB RE −
            // net profit (Income − Expenses).
            decimal SignedSec(string s) => rows.Where(r => r.section == s).Sum(r => r.isDebit ? r.amount : -r.amount);
            decimal netProfitCredit = -SignedSec("Income") - SignedSec("Expenses");  // profit → positive (a credit)
            for (int i = 0; i < rows.Count; i++)
            {
                if (rows[i].section == "Equity" && rows[i].name.Equals("Retained earnings", StringComparison.OrdinalIgnoreCase))
                {
                    var signed = (rows[i].isDebit ? rows[i].amount : -rows[i].amount) + netProfitCredit;  // -164.6M + 151.8M = -12.8M
                    rows[i] = (rows[i].section, rows[i].name, Math.Abs(signed), signed >= 0);
                    break;
                }
            }

            var stmt = new Dictionary<string, FinancialStatement>
            { ["Assets"] = FinancialStatement.BalanceSheet, ["Liabilities"] = FinancialStatement.BalanceSheet, ["Equity"] = FinancialStatement.BalanceSheet, ["Income"] = FinancialStatement.ProfitAndLoss, ["Expenses"] = FinancialStatement.ProfitAndLoss };
            var atype = new Dictionary<string, AccountType>
            { ["Assets"] = AccountType.Asset, ["Liabilities"] = AccountType.Liability, ["Equity"] = AccountType.Equity, ["Income"] = AccountType.Income, ["Expenses"] = AccountType.Expense };

            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                // Replace any existing CoA + GL for the company (idempotent reload).
                // Document-derived postings (if GL was enabled in the app) must go
                // first — they FK to Accounts and would double-count the opening
                // balances we're about to load.
                await _db.JournalLines.Where(l => l.JournalEntry.CompanyId == companyId).ExecuteDeleteAsync();
                await _db.JournalEntries.Where(e => e.CompanyId == companyId).ExecuteDeleteAsync();
                await _db.AccountTransfers.Where(t => t.CompanyId == companyId).ExecuteDeleteAsync();
                await _db.Accounts.Where(a => a.CompanyId == companyId).ExecuteDeleteAsync();
                await _db.AccountGroups.Where(g => g.CompanyId == companyId).ExecuteDeleteAsync();

                var groupIdBySection = new Dictionary<string, int>();
                int pos = 0;
                foreach (var sec in new[] { "Assets", "Liabilities", "Equity", "Income", "Expenses" })
                {
                    if (!rows.Any(r => r.section == sec)) continue;
                    var g = new AccountGroup { CompanyId = companyId, Name = sec, Statement = stmt[sec], Position = pos++, ExternalRef = $"mgr-tbgrp:{sec}" };
                    _db.AccountGroups.Add(g); await _db.SaveChangesAsync();
                    groupIdBySection[sec] = g.Id;
                }
                // ── Path A: expand Manager's rolled-up cash line into its real
                //    Bank & Cash Accounts (each flagged ControlType.BankCash) so the
                //    receipt/payment "Received in" dropdown is populated. The 13
                //    balances sum to the single TB roll-up line, so swapping them in
                //    is net-zero on total assets. Read from Manager's
                //    "bank-and-cash-accounts" summary list (key/name/actualBalance).
                var banks = new List<(string Key, string Name, decimal Balance)>();
                if (summaryDocs != null
                    && summaryDocs.TryGetValue("bank-and-cash-accounts", out var bcDoc)
                    && bcDoc.RootElement.ValueKind == JsonValueKind.Array)
                    foreach (var e in bcDoc.RootElement.EnumerateArray())
                    {
                        var key = Str(e, "key");
                        if (!string.IsNullOrEmpty(key)) banks.Add((key!, Str(e, "name") ?? "", Money(e, "actualBalance")));
                    }

                // Identify the TB asset line that rolls the bank/cash balances up —
                // primary match by signed amount (== Σ bank balances), fallback by
                // name. rollupIdx < 0 ⇒ couldn't identify it (safe: keep the line,
                // add banks at zero so the total never double-counts).
                int rollupIdx = -1;
                if (banks.Count > 0)
                {
                    decimal bankSum = banks.Sum(b => b.Balance);
                    for (int i = 0; i < rows.Count; i++)
                    {
                        if (rows[i].section != "Assets") continue;
                        var signed = rows[i].isDebit ? rows[i].amount : -rows[i].amount;
                        if (Math.Abs(signed - bankSum) < 0.01m) { rollupIdx = i; break; }
                    }
                    if (rollupIdx < 0)
                        for (int i = 0; i < rows.Count; i++)
                            if (rows[i].section == "Assets" && CashRollupNames.Contains(rows[i].name)) { rollupIdx = i; break; }
                }
                bool rollupFound = rollupIdx >= 0;

                int apos = 0;
                for (int i = 0; i < rows.Count; i++)
                {
                    if (i == rollupIdx) continue;   // replaced by the individual bank/cash accounts below
                    var r = rows[i];
                    _db.Accounts.Add(new Account
                    {
                        CompanyId = companyId, Name = r.name, AccountGroupId = groupIdBySection[r.section],
                        AccountType = atype[r.section], OpeningBalance = Math.Abs(r.amount), OpeningBalanceIsDebit = r.isDebit,
                        IsActive = true, Position = apos++, ControlType = ControlType.None,
                        ExternalRef = $"mgr-tbacct:{r.section}:{(r.name.Length > 40 ? r.name[..40] : r.name)}",
                    });
                }
                await _db.SaveChangesAsync();

                int bankCount = 0;
                if (banks.Count > 0)
                {
                    // Nest under Assets (create the group if the TB had no asset rows).
                    if (!groupIdBySection.TryGetValue("Assets", out var assetsGroupId))
                    {
                        var ag = new AccountGroup { CompanyId = companyId, Name = "Assets", Statement = FinancialStatement.BalanceSheet, Position = pos++, ExternalRef = "mgr-tbgrp:Assets" };
                        _db.AccountGroups.Add(ag); await _db.SaveChangesAsync();
                        assetsGroupId = ag.Id; groupIdBySection["Assets"] = assetsGroupId;
                    }
                    var bankGroup = new AccountGroup { CompanyId = companyId, Name = "Bank & Cash Accounts", Statement = FinancialStatement.BalanceSheet, ParentGroupId = assetsGroupId, Position = pos++, ExternalRef = "mgr-bankcash-group" };
                    _db.AccountGroups.Add(bankGroup); await _db.SaveChangesAsync();

                    int bpos = 0;
                    foreach (var b in banks)
                    {
                        // Real balance only when we could remove the roll-up (else the
                        // cash total stays on its TB line — never double-count).
                        decimal bal = rollupFound ? b.Balance : 0m;
                        _db.Accounts.Add(new Account
                        {
                            CompanyId = companyId, Name = string.IsNullOrWhiteSpace(b.Name) ? "(unnamed account)" : b.Name,
                            AccountGroupId = bankGroup.Id, AccountType = AccountType.Asset,
                            OpeningBalance = Math.Abs(bal), OpeningBalanceIsDebit = bal >= 0,
                            IsActive = true, Position = 1000 + bpos++, ControlType = ControlType.BankCash,
                            ExternalRef = $"mgr-bankcash:{b.Key}",
                        });
                        bankCount++;
                    }
                    await _db.SaveChangesAsync();

                    if (rollupFound)
                    {
                        var rr = rows[rollupIdx];
                        report.Notes.Add($"Bank & Cash: created {bankCount} account(s) flagged BankCash, replacing the rolled-up cash line \"{rr.name}\" ({(rr.isDebit ? rr.amount : -rr.amount):N2}) — total assets unchanged; the receipt/payment dropdown is now populated.");
                    }
                    else
                        report.Notes.Add($"Bank & Cash: created {bankCount} account(s) flagged BankCash at ZERO opening balance — could not identify the cash roll-up line in the trial balance, so the cash total stays on its TB line. Set individual balances / reconcile manually.");
                }
                report.Created["bankCashAccounts"] = bankCount;

                // Opening-balance snapshot mode: turn document GL posting OFF so
                // these balances stay authoritative (a "rebuild GL" would otherwise
                // re-post the historical documents and double-count). Re-enable
                // deliberately only if you want live GL from new documents.
                company.GlPostingEnabled = false;
                await _db.SaveChangesAsync();

                report.Created["coaGroups"] = groupIdBySection.Count + (bankCount > 0 ? 1 : 0);
                report.Created["coaAccounts"] = rows.Count - (rollupFound ? 1 : 0) + bankCount;

                // Reconciliation (debit-positive sums).
                decimal Sec(string s) => rows.Where(r => r.section == s).Sum(r => r.isDebit ? r.amount : -r.amount);
                decimal assets = Sec("Assets"), liab = -Sec("Liabilities"), equity = -Sec("Equity"),
                        income = -Sec("Income"), expense = Sec("Expenses");
                report.Notes.Add($"Balance sheet: Assets {assets:N2} = Liabilities {liab:N2} + Equity {equity:N2}  (diff {assets - liab - equity:N2}).");
                report.Notes.Add($"P&L: Income {income:N2} - Expenses {expense:N2} = Net profit {income - expense:N2}.");
                report.Notes.Add("Loaded as account opening balances; GL posting engine left off so imported documents don't double-count.");

                if (dryRun) { await tx.RollbackAsync(); report.Notes.Add("DRY RUN - rolled back."); }
                else await tx.CommitAsync();
                return report;
            }
            catch { await tx.RollbackAsync(); throw; }
        }

        public ManagerImportReport PreviewTrialBalance(string trialBalanceText)
        {
            var rows = ParseTrialBalance(trialBalanceText);
            var report = new ManagerImportReport { DryRun = true };
            report.Created["trialBalanceAccounts"] = rows.Count;
            if (rows.Count > 0)
            {
                decimal Sec(string s) => rows.Where(r => r.section == s).Sum(r => r.isDebit ? r.amount : -r.amount);
                decimal assets = Sec("Assets"), liab = -Sec("Liabilities"), equity = -Sec("Equity"),
                        income = -Sec("Income"), expense = Sec("Expenses");
                report.Notes.Add($"Trial balance preview: {rows.Count} accounts. Balance sheet Assets {assets:N2} = Liabilities {liab:N2} + Equity {equity:N2} (diff {assets - liab - equity:N2}); P&L Income {income:N2} - Expenses {expense:N2} = Net {income - expense:N2}.");
            }
            report.Notes.Add("Trial balance NOT loaded (dry run) — commit to load it as chart-of-accounts opening balances.");
            return report;
        }

        // Parse a Manager Trial Balance export (tab-separated). Rows are
        // (section, account name, amount, isDebit); section headers set the
        // current section; group headers / the "Net profit" plug / totals / zero
        // rows are skipped.
        private static List<(string section, string name, decimal amount, bool isDebit)> ParseTrialBalance(string text)
        {
            var sections = new HashSet<string> { "Income", "Expenses", "Assets", "Liabilities", "Equity" };
            var skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "ADVANCE SHOP", "Net profit (loss)", "Net profit", "Net loss" };
            var result = new List<(string, string, decimal, bool)>();
            string? sec = null;
            foreach (var raw in text.Replace("\r", "").Split('\n'))
            {
                var parts = raw.Split('\t');
                var name = parts[0].Trim();
                if (name.Length == 0) continue;             // totals row (leading tab) / blank
                if (sections.Contains(name)) { sec = name; continue; }
                if (skip.Contains(name) || sec == null) continue;
                decimal? Num(int i)
                {
                    if (i >= parts.Length) return null;
                    var s = parts[i].Trim().Replace(",", "");
                    return decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : (decimal?)null;
                }
                var debit = Num(1); var credit = Num(2);
                if (debit == null && credit == null) continue;   // zero-balance / group header
                result.Add((sec, name, debit ?? credit!.Value, debit != null));
            }
            return result;
        }

        // Seed Starting/Current next-number fields on the company and each
        // division from the max imported document number, so config screens
        // don't read 0 and new documents continue the sequence. Keyed by
        // (DivisionId ?? 0) so a null-division (company-level) doc seeds the
        // company and a division-tagged doc seeds that division.
        private async Task SeedStartingNumbersAsync(int companyId)
        {
            static (int s, int c) Next(int max, int s, int c)
            { if (max > 0) { if (max + 1 > s) s = max + 1; if (max > c) c = max; } return (s, c); }

            var inv = await _db.Invoices.Where(i => i.CompanyId == companyId && i.DocumentType != 9 && i.DocumentType != 10)
                .GroupBy(i => i.DivisionId ?? 0).Select(g => new { K = g.Key, M = g.Max(x => x.InvoiceNumber) }).ToDictionaryAsync(x => x.K, x => x.M);
            var cn = await _db.Invoices.Where(i => i.CompanyId == companyId && i.DocumentType == 10)
                .GroupBy(i => i.DivisionId ?? 0).Select(g => new { K = g.Key, M = g.Max(x => x.InvoiceNumber) }).ToDictionaryAsync(x => x.K, x => x.M);
            var dn = await _db.Invoices.Where(i => i.CompanyId == companyId && i.DocumentType == 9)
                .GroupBy(i => i.DivisionId ?? 0).Select(g => new { K = g.Key, M = g.Max(x => x.InvoiceNumber) }).ToDictionaryAsync(x => x.K, x => x.M);
            var quote = await _db.SalesQuotes.Where(q => q.CompanyId == companyId)
                .GroupBy(q => q.DivisionId ?? 0).Select(g => new { K = g.Key, M = g.Max(x => x.QuoteNumber) }).ToDictionaryAsync(x => x.K, x => x.M);
            var order = await _db.SalesOrders.Where(o => o.CompanyId == companyId)
                .GroupBy(o => o.DivisionId ?? 0).Select(g => new { K = g.Key, M = g.Max(x => x.SalesOrderNumber) }).ToDictionaryAsync(x => x.K, x => x.M);
            var challan = await _db.DeliveryChallans.Where(c => c.CompanyId == companyId)
                .GroupBy(c => c.DivisionId ?? 0).Select(g => new { K = g.Key, M = g.Max(x => x.ChallanNumber) }).ToDictionaryAsync(x => x.K, x => x.M);
            var billMax = await _db.PurchaseBills.Where(p => p.CompanyId == companyId).Select(p => (int?)p.PurchaseBillNumber).MaxAsync() ?? 0;

            foreach (var d in await _db.Divisions.Where(x => x.CompanyId == companyId).ToListAsync())
            {
                (d.StartingInvoiceNumber, d.CurrentInvoiceNumber) = Next(inv.GetValueOrDefault(d.Id), d.StartingInvoiceNumber, d.CurrentInvoiceNumber);
                (d.StartingSalesQuoteNumber, d.CurrentSalesQuoteNumber) = Next(quote.GetValueOrDefault(d.Id), d.StartingSalesQuoteNumber, d.CurrentSalesQuoteNumber);
                (d.StartingSalesOrderNumber, d.CurrentSalesOrderNumber) = Next(order.GetValueOrDefault(d.Id), d.StartingSalesOrderNumber, d.CurrentSalesOrderNumber);
                (d.StartingChallanNumber, d.CurrentChallanNumber) = Next(challan.GetValueOrDefault(d.Id), d.StartingChallanNumber, d.CurrentChallanNumber);
                (d.StartingCreditNoteNumber, d.CurrentCreditNoteNumber) = Next(cn.GetValueOrDefault(d.Id), d.StartingCreditNoteNumber, d.CurrentCreditNoteNumber);
                (d.StartingDebitNoteNumber, d.CurrentDebitNoteNumber) = Next(dn.GetValueOrDefault(d.Id), d.StartingDebitNoteNumber, d.CurrentDebitNoteNumber);
            }

            var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
            (company.StartingInvoiceNumber, company.CurrentInvoiceNumber) = Next(inv.GetValueOrDefault(0), company.StartingInvoiceNumber, company.CurrentInvoiceNumber);
            (company.StartingSalesQuoteNumber, company.CurrentSalesQuoteNumber) = Next(quote.GetValueOrDefault(0), company.StartingSalesQuoteNumber, company.CurrentSalesQuoteNumber);
            (company.StartingSalesOrderNumber, company.CurrentSalesOrderNumber) = Next(order.GetValueOrDefault(0), company.StartingSalesOrderNumber, company.CurrentSalesOrderNumber);
            (company.StartingChallanNumber, company.CurrentChallanNumber) = Next(challan.GetValueOrDefault(0), company.StartingChallanNumber, company.CurrentChallanNumber);
            (company.StartingCreditNoteNumber, company.CurrentCreditNoteNumber) = Next(cn.GetValueOrDefault(0), company.StartingCreditNoteNumber, company.CurrentCreditNoteNumber);
            (company.StartingDebitNoteNumber, company.CurrentDebitNoteNumber) = Next(dn.GetValueOrDefault(0), company.StartingDebitNoteNumber, company.CurrentDebitNoteNumber);
            (company.StartingPurchaseBillNumber, company.CurrentPurchaseBillNumber) = Next(billMax, company.StartingPurchaseBillNumber, company.CurrentPurchaseBillNumber);
            await _db.SaveChangesAsync();
        }

        // --fresh: delete a company's imported data (child-first).
        private async Task WipeCompanyAsync(int companyId)
        {
            await _db.JournalLines.Where(l => l.JournalEntry.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.JournalEntries.Where(e => e.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.AccountTransfers.Where(t => t.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.PaymentAllocations.Where(a => a.Payment.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.Payments.Where(p => p.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.WithholdingTaxReceipts.Where(w => w.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.InvoiceItems.Where(ii => ii.Invoice!.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.Invoices.Where(i => i.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.PurchaseItems.Where(pi => pi.PurchaseBill!.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.PurchaseBills.Where(p => p.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.DeliveryItems.Where(di => di.DeliveryChallan!.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.DeliveryChallans.Where(c => c.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.SalesQuoteItems.Where(qi => qi.SalesQuote!.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.SalesQuotes.Where(q => q.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.SalesOrderItems.Where(oi => oi.SalesOrder!.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.SalesOrders.Where(o => o.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.Clients.Where(c => c.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.Suppliers.Where(s => s.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.Accounts.Where(a => a.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.AccountGroups.Where(g => g.CompanyId == companyId).ExecuteDeleteAsync();
            await _db.Divisions.Where(d => d.CompanyId == companyId).ExecuteDeleteAsync();
        }
    }
}
