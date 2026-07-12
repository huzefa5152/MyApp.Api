using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;

// ============================================================================
// Al-Qahera Manager.io -> MyApp ETL (one-off migration).
//
// Reads the exported JSON (scripts/pull_details.py output) and writes a new
// MyApp Company + Divisions + Clients/Suppliers + sales & purchase documents +
// receipts/payments via EF Core, mirroring LegacyImportService conventions:
// ExternalRef idempotency (mgr-* keys), masters -> docs -> money order, and
// GL-anchored authoritative totals from the Manager list view.
//
// Usage:
//   dotnet run --project tools/ManagerImport -- <exportDir> "<connString>" [--dry-run] [--fresh] [--company-name NAME]
//
// exportDir = folder containing {entity}.json (summary) and detail/{entity}.json
// --dry-run = do everything in a transaction, print the report, then ROLL BACK.
// --fresh   = if the target company already exists, wipe its data and reload.
//
// Deferred to a v2 follow-up (documented, not loaded here):
//   credit-notes (41), debit-notes (1)  -> Invoice.NoteKind has a private setter
//   journal-entries (131), inter-account-transfers (72), withholding-tax-receipts (88)
//   full chart-of-accounts tree (Manager gives only code+name, no type/statement)
// ============================================================================

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: ManagerImport <exportDir> <connString> [--dry-run] [--fresh] [--company-name NAME]");
    return 2;
}

string exportDir = args[0];
string conn = args[1];
bool dryRun = args.Contains("--dry-run");
bool fresh = args.Contains("--fresh");
string companyName = GetOpt("--company-name") ?? "Al-Qahera Trading Co.";
string detailDir = Path.Combine(exportDir, "detail");

string? GetOpt(string flag)
{
    var i = Array.IndexOf(args, flag);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

if (!Directory.Exists(detailDir))
{
    Console.Error.WriteLine($"detail dir not found: {detailDir}");
    return 2;
}

Console.WriteLine($"== ManagerImport ==  company=\"{companyName}\"  dryRun={dryRun}  fresh={fresh}");
Console.WriteLine($"   source: {exportDir}");

// ── JSON helpers ────────────────────────────────────────────────────────────
var docCache = new Dictionary<string, JsonDocument>();
IEnumerable<JsonElement> Rows(string entity, bool detail = true)
{
    var path = Path.Combine(detail ? detailDir : exportDir, entity + ".json");
    if (!docCache.TryGetValue(path, out var doc))
    {
        doc = JsonDocument.Parse(File.ReadAllText(path));
        docCache[path] = doc;
    }
    return doc.RootElement.EnumerateArray();
}
static string? Str(JsonElement e, string p) =>
    e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
static decimal Money(JsonElement e, string p)
{
    if (!e.TryGetProperty(p, out var v)) return 0m;
    if (v.ValueKind == JsonValueKind.Number) return v.GetDecimal();
    if (v.ValueKind == JsonValueKind.Object && v.TryGetProperty("value", out var val)
        && val.ValueKind == JsonValueKind.Number) return val.GetDecimal();
    return 0m;
}
static DateTime? Date(JsonElement e, string p)
{
    var s = Str(e, p);
    return DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
}
static int RefNum(JsonElement e, string p = "Reference")
{
    var s = Str(e, p)?.Trim();
    return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;
}
static string Uom(JsonElement line)
{
    if (line.TryGetProperty("CustomFields", out var cf) && cf.ValueKind == JsonValueKind.Object)
        foreach (var prop in cf.EnumerateObject())
            if (prop.Value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(prop.Value.GetString()))
                return prop.Value.GetString()!.Trim();
    return "";
}
// Parse Manager's free-text BillingAddress block -> (address, NTN, STRN).
static (string? addr, string? ntn, string? strn) ParseAddr(string? billing)
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

// ── Per-scope document-number allocator ─────────────────────────────────────
// Preserves Manager's numeric Reference where it's free within (scope); else
// allocates max+1. scope = DivisionId (0 = company-level) or direction, etc.
var usedNums = new Dictionary<string, HashSet<int>>();
var maxNums = new Dictionary<string, int>();
int Alloc(string scope, int desired, bool unique = true)
{
    var used = usedNums.TryGetValue(scope, out var s) ? s : (usedNums[scope] = new HashSet<int>());
    if (!unique) { if (desired > 0) return desired; }        // challans: dups allowed
    int n;
    if (desired > 0 && !used.Contains(desired)) n = desired;
    else { n = Math.Max(maxNums.GetValueOrDefault(scope), desired) + 1; while (used.Contains(n)) n++; }
    used.Add(n);
    if (n > maxNums.GetValueOrDefault(scope)) maxNums[scope] = n;
    return n;
}

var report = new List<string>();
void Rep(string line) { report.Add(line); Console.WriteLine("   " + line); }

// ── Build the DbContext directly on the target DB (no DI; FbrToken converter
//    is skipped without a protector, which is fine — we set FbrEnabled=false). ─
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseSqlServer(conn)
    .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning))
    .Options;
await using var db = new AppDbContext(options);

Console.WriteLine($"   db: {db.Database.GetDbConnection().DataSource} / {db.Database.GetDbConnection().Database}");
await using var tx = await db.Database.BeginTransactionAsync();

try
{
    // ── Phase 0: Company ────────────────────────────────────────────────────
    var company = await db.Companies.FirstOrDefaultAsync(c => c.Name == companyName);
    if (company != null)
    {
        var hasData = await db.Invoices.AnyAsync(i => i.CompanyId == company.Id)
                      || await db.Clients.AnyAsync(c => c.CompanyId == company.Id);
        if (hasData && !fresh)
        {
            Console.Error.WriteLine($"Company \"{companyName}\" (id={company.Id}) already has data. Pass --fresh to wipe & reload.");
            await tx.RollbackAsync();
            return 3;
        }
        if (hasData && fresh)
        {
            await WipeCompanyAsync(db, company.Id);
            Rep($"--fresh: wiped existing data for company id={company.Id}");
        }
    }
    if (company == null)
    {
        company = new Company
        {
            Name = companyName,
            FbrEnabled = false,
            IsTenantIsolated = false,          // visible to all dev users + seed admin
            InventoryTrackingEnabled = false,  // Manager has no inventory module in use
        };
        db.Companies.Add(company);
        await db.SaveChangesAsync();
    }
    int companyId = company.Id;
    Rep($"company id={companyId}  \"{companyName}\"");

    // Grant every existing user access (mirrors the RBAC backfill) so the
    // company is visible regardless of which login is used.
    var userIds = await db.Users.Select(u => u.Id).ToListAsync();
    var linked = await db.UserCompanies.Where(uc => uc.CompanyId == companyId).Select(uc => uc.UserId).ToListAsync();
    var toLink = userIds.Except(linked).ToList();
    foreach (var uid in toLink) db.UserCompanies.Add(new UserCompany { UserId = uid, CompanyId = companyId });
    await db.SaveChangesAsync();
    Rep($"user access grants: +{toLink.Count} (total users {userIds.Count})");

    // ── Phase 1: Divisions ──────────────────────────────────────────────────
    var divIdByGuid = new Dictionary<string, int>();
    var divIdByName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    int newDivs = 0;
    foreach (var d in Rows("divisions", detail: false))
    {
        var key = Str(d, "key")!; var name = (Str(d, "name") ?? "Division").Trim();
        var existing = await db.Divisions.FirstOrDefaultAsync(x => x.CompanyId == companyId && x.Name == name);
        if (existing == null)
        {
            existing = new Division { CompanyId = companyId, Name = name };
            db.Divisions.Add(existing); await db.SaveChangesAsync(); newDivs++;
        }
        divIdByGuid[key] = existing.Id; divIdByName[name] = existing.Id;
    }
    Rep($"divisions: +{newDivs}");

    // ── Phase 2: Parties ────────────────────────────────────────────────────
    var clientIdByGuid = new Dictionary<string, int>();
    var supplierIdByGuid = new Dictionary<string, int>();
    int newClients = 0, newSuppliers = 0;
    foreach (var c in Rows("customers"))
    {
        var key = Str(c, "Key") ?? Str(c, "id")!;
        var (addr, ntn, strn) = ParseAddr(Str(c, "BillingAddress") ?? Str(c, "DefaultBillingAddress"));
        var row = new Client
        {
            CompanyId = companyId, Name = (Str(c, "Name") ?? "(unnamed)").Trim(),
            Address = addr, NTN = ntn, STRN = strn, ExternalRef = $"mgr-cust:{key}",
        };
        db.Clients.Add(row); clientIdByGuid[key] = -1; newClients++;
    }
    await db.SaveChangesAsync();
    foreach (var row in db.Clients.Local.Where(c => c.CompanyId == companyId))
        if (row.ExternalRef?.StartsWith("mgr-cust:") == true) clientIdByGuid[row.ExternalRef["mgr-cust:".Length..]] = row.Id;

    foreach (var s in Rows("suppliers"))
    {
        var key = Str(s, "Key") ?? Str(s, "id")!;
        var (addr, ntn, strn) = ParseAddr(Str(s, "BillingAddress") ?? Str(s, "DefaultBillingAddress"));
        var row = new Supplier
        {
            CompanyId = companyId, Name = (Str(s, "Name") ?? "(unnamed)").Trim(),
            Address = addr, NTN = ntn, STRN = strn, ExternalRef = $"mgr-supp:{key}",
        };
        db.Suppliers.Add(row); newSuppliers++;
    }
    await db.SaveChangesAsync();
    foreach (var row in db.Suppliers.Local.Where(s => s.CompanyId == companyId))
        if (row.ExternalRef?.StartsWith("mgr-supp:") == true) supplierIdByGuid[row.ExternalRef["mgr-supp:".Length..]] = row.Id;
    Rep($"clients: +{newClients}   suppliers: +{newSuppliers}");

    // Summary lookups (authoritative money totals live in the list view).
    var invAmountByGuid = Rows("sales-invoices", detail: false)
        .ToDictionary(e => Str(e, "key")!, e => (total: Money(e, "invoiceAmount"), balance: Money(e, "balanceDue")));
    var billAmountByGuid = Rows("purchase-invoices", detail: false)
        .ToDictionary(e => Str(e, "key")!, e => (total: Money(e, "invoiceAmount"), balance: Money(e, "balanceDue")));

    int? DivFromLines(JsonElement doc)
    {
        if (doc.TryGetProperty("Lines", out var lines) && lines.ValueKind == JsonValueKind.Array)
            foreach (var ln in lines.EnumerateArray())
            {
                var g = Str(ln, "Division");
                if (g != null && divIdByGuid.TryGetValue(g, out var id)) return id;
            }
        // header CustomFields sometimes carry the division NAME
        if (doc.TryGetProperty("CustomFields", out var cf) && cf.ValueKind == JsonValueKind.Object)
            foreach (var p in cf.EnumerateObject())
                if (p.Value.ValueKind == JsonValueKind.String && divIdByName.TryGetValue(p.Value.GetString()!.Trim(), out var id))
                    return id;
        return null;
    }
    (decimal qty, decimal price, string desc, string uom) Line(JsonElement ln, string priceProp)
        => (ln.TryGetProperty("Qty", out var q) && q.ValueKind == JsonValueKind.Number ? q.GetDecimal() : 0m,
            Money(ln, priceProp), (Str(ln, "LineDescription") ?? "").Trim(), Uom(ln));

    // ── Phase 3: Sales quotes ───────────────────────────────────────────────
    int nQuote = 0;
    foreach (var h in Rows("sales-quotes"))
    {
        var cust = Str(h, "Customer");
        if (cust == null || !clientIdByGuid.TryGetValue(cust, out var clientId)) continue;
        int num = Alloc("quote:0", RefNum(h));
        var items = new List<SalesQuoteItem>();
        if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
            foreach (var ln in L.EnumerateArray())
            { var (qq, pp, dd, uu) = Line(ln, "SalesUnitPrice"); items.Add(new SalesQuoteItem { Description = dd, Quantity = qq, Unit = uu, UnitPrice = pp, LineTotal = Math.Round(qq * pp, 2) }); }
        var sub = items.Sum(i => i.LineTotal);
        db.SalesQuotes.Add(new SalesQuote
        {
            CompanyId = companyId, DivisionId = null, ClientId = clientId, QuoteNumber = num,
            Date = Date(h, "IssueDate") ?? DateTime.Today, Subtotal = sub, GSTRate = 0, GSTAmount = 0,
            GrandTotal = sub, AmountInWords = "", Status = "Sent", Items = items,
        });
        nQuote++;
    }
    await db.SaveChangesAsync(); db.ChangeTracker.Clear();
    Rep($"sales quotes: +{nQuote}");

    // ── Phase 4: Sales orders ───────────────────────────────────────────────
    int nSo = 0;
    foreach (var h in Rows("sales-orders"))
    {
        var cust = Str(h, "Customer");
        if (cust == null || !clientIdByGuid.TryGetValue(cust, out var clientId)) continue;
        int num = Alloc("so:0", RefNum(h));
        var items = new List<SalesOrderItem>();
        if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
            foreach (var ln in L.EnumerateArray())
            { var (qq, _, dd, uu) = Line(ln, "SalesUnitPrice"); items.Add(new SalesOrderItem { Description = dd, Quantity = qq, Unit = uu }); }
        db.SalesOrders.Add(new SalesOrder
        {
            CompanyId = companyId, DivisionId = null, ClientId = clientId, SalesOrderNumber = num,
            OrderDate = Date(h, "IssueDate") ?? DateTime.Today, Status = "Open", IsImported = true, Items = items,
        });
        nSo++;
    }
    await db.SaveChangesAsync(); db.ChangeTracker.Clear();
    Rep($"sales orders: +{nSo}");

    // ── Phase 5: Delivery notes (challans; challan numbers non-unique) ───────
    int nDc = 0;
    foreach (var h in Rows("delivery-notes"))
    {
        var cust = Str(h, "Customer");
        if (cust == null || !clientIdByGuid.TryGetValue(cust, out var clientId)) continue;
        int num = Alloc("dc:0", RefNum(h), unique: false);
        var items = new List<DeliveryItem>();
        if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
            foreach (var ln in L.EnumerateArray())
            { var (qq, _, dd, uu) = Line(ln, "SalesUnitPrice"); items.Add(new DeliveryItem { Description = dd, Quantity = qq, Unit = uu }); }
        db.DeliveryChallans.Add(new DeliveryChallan
        {
            CompanyId = companyId, DivisionId = null, ClientId = clientId, ChallanNumber = num,
            PoNumber = "", DeliveryDate = Date(h, "DeliveryDate"), Status = "Imported", IsImported = true, Items = items,
        });
        nDc++;
    }
    await db.SaveChangesAsync(); db.ChangeTracker.Clear();
    Rep($"delivery challans: +{nDc}");

    // ── Phase 6: Sales invoices (authoritative total from list view) ─────────
    var invoiceIdByGuid = new Dictionary<string, int>();
    int nInv = 0;
    foreach (var h in Rows("sales-invoices"))
    {
        var key = Str(h, "Key") ?? Str(h, "id")!;
        var cust = Str(h, "Customer");
        if (cust == null || !clientIdByGuid.TryGetValue(cust, out var clientId)) continue;
        int? divId = DivFromLines(h);
        int num = Alloc($"inv:{divId ?? 0}", RefNum(h));
        var total = invAmountByGuid.TryGetValue(key, out var m) ? m.total : 0m;
        var items = new List<InvoiceItem>();
        if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
            foreach (var ln in L.EnumerateArray())
            { var (qq, pp, dd, uu) = Line(ln, "SalesUnitPrice"); items.Add(new InvoiceItem { Description = dd, Quantity = qq, UOM = uu, UnitPrice = pp, LineTotal = Math.Round(qq * pp, 2) }); }
        if (total <= 0) total = items.Sum(i => i.LineTotal);
        var inv = new Invoice
        {
            CompanyId = companyId, ClientId = clientId, DivisionId = divId, InvoiceNumber = num,
            Date = Date(h, "IssueDate") ?? DateTime.Today, Subtotal = total, GSTRate = 0, GSTAmount = 0,
            GrandTotal = total, AmountInWords = "", IsMigrated = true, IsFbrExcluded = true,
            ExternalRef = $"mgr-sinv:{key}", Items = items,
        };
        db.Invoices.Add(inv); invoiceIdByGuid[key] = -1; nInv++;
    }
    await db.SaveChangesAsync();
    foreach (var inv in db.Invoices.Local.Where(i => i.CompanyId == companyId))
        if (inv.ExternalRef?.StartsWith("mgr-sinv:") == true) invoiceIdByGuid[inv.ExternalRef["mgr-sinv:".Length..]] = inv.Id;
    db.ChangeTracker.Clear();
    Rep($"sales invoices: +{nInv}");

    // ── Phase 7: Purchase invoices (bills) ───────────────────────────────────
    var billIdByGuid = new Dictionary<string, int>();
    int nBill = 0;
    foreach (var h in Rows("purchase-invoices"))
    {
        var key = Str(h, "Key") ?? Str(h, "id")!;
        var supp = Str(h, "Supplier");
        if (supp == null || !supplierIdByGuid.TryGetValue(supp, out var supplierId)) continue;
        int num = Alloc("bill:0", RefNum(h));
        var total = billAmountByGuid.TryGetValue(key, out var m) ? m.total : 0m;
        var items = new List<PurchaseItem>();
        if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
            foreach (var ln in L.EnumerateArray())
            { var (qq, pp, dd, uu) = Line(ln, "PurchaseUnitPrice"); items.Add(new PurchaseItem { Description = dd, Quantity = qq, UOM = uu, UnitPrice = pp, LineTotal = Math.Round(qq * pp, 2) }); }
        if (total <= 0) total = items.Sum(i => i.LineTotal);
        var bill = new PurchaseBill
        {
            CompanyId = companyId, SupplierId = supplierId, PurchaseBillNumber = num,
            Date = Date(h, "IssueDate") ?? DateTime.Today, Subtotal = total, GSTRate = 0, GSTAmount = 0,
            GrandTotal = total, AmountInWords = "", IsMigrated = true, ExternalRef = $"mgr-pinv:{key}", Items = items,
        };
        db.PurchaseBills.Add(bill); billIdByGuid[key] = -1; nBill++;
    }
    await db.SaveChangesAsync();
    foreach (var b in db.PurchaseBills.Local.Where(p => p.CompanyId == companyId))
        if (b.ExternalRef?.StartsWith("mgr-pinv:") == true) billIdByGuid[b.ExternalRef["mgr-pinv:".Length..]] = b.Id;
    db.ChangeTracker.Clear();
    Rep($"purchase bills: +{nBill}");

    // ── Phase 7b: Credit / Debit notes (Invoice rows, DocumentType 10/9) ─────
    // NoteKind is a SQL computed column from DocumentType (10->2 credit, 9->1
    // debit). Notes are EXCLUDED from MyApp's AR calc (ClientService filters
    // DocumentType !=9/10); we also set AmountPaid=GrandTotal so they stay
    // AR-neutral in the reconciliation below. Numbering is a separate per-
    // (division, NoteKind) sequence, so it never collides with sale invoices.
    int nCn = 0, nDn = 0, noteNoClient = 0;
    async Task ImportNotesAsync(string entity, int docType, string erPrefix)
    {
        int made = 0;
        foreach (var h in Rows(entity))
        {
            var key = Str(h, "Key") ?? Str(h, "id")!;
            var cust = Str(h, "Customer");
            if (cust == null || !clientIdByGuid.TryGetValue(cust, out var clientId)) { noteNoClient++; continue; }
            int? divId = DivFromLines(h);
            int? origId = Str(h, "SalesInvoice") is { } og && invoiceIdByGuid.TryGetValue(og, out var oid) ? oid : (int?)null;
            int num = Alloc($"note:{docType}:{divId ?? 0}", RefNum(h));
            var items = new List<InvoiceItem>();
            if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
                foreach (var ln in L.EnumerateArray())
                { var (qq, pp, dd, uu) = Line(ln, "SalesUnitPrice"); var q = qq <= 0 ? 1m : qq; items.Add(new InvoiceItem { Description = dd, Quantity = q, UOM = uu, UnitPrice = pp, LineTotal = Math.Round(q * pp, 2) }); }
            var total = items.Sum(i => i.LineTotal);
            db.Invoices.Add(new Invoice
            {
                CompanyId = companyId, ClientId = clientId, DivisionId = divId, InvoiceNumber = num,
                Date = Date(h, "IssueDate") ?? DateTime.Today, Subtotal = total, GSTRate = 0, GSTAmount = 0,
                GrandTotal = total, AmountPaid = total, AmountInWords = "", DocumentType = docType,
                OriginalInvoiceId = origId, IsMigrated = true, IsFbrExcluded = true,
                ExternalRef = $"{erPrefix}{key}", Items = items,
            });
            made++;
        }
        await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        if (docType == 10) nCn = made; else nDn = made;
    }
    await ImportNotesAsync("credit-notes", 10, "mgr-scn:");
    await ImportNotesAsync("debit-notes", 9, "mgr-sdn:");
    Rep($"credit notes: +{nCn}   debit notes: +{nDn}   (skipped no-client: {noteNoClient})");

    // ── Phase 8: bank/cash account names (for Payment.BankAccountName) ───────
    var bankNameByGuid = Rows("bank-and-cash-accounts", detail: false)
        .ToDictionary(e => Str(e, "key")!, e => Str(e, "name") ?? "");

    // ── Phase 9: Receipts (money in) — allocate to invoices ─────────────────
    var (nRcp, rcpUnalloc) = await ImportMoneyAsync(
        db, companyId, PaymentDirection.Receipt, "receipts",
        contactGuidProp: null, contactMap: clientIdByGuid, contactType: "Client",
        bankProp: "ReceivedIn", bankNameByGuid: bankNameByGuid,
        lineDocProp: "AccountsReceivableSalesInvoice", docMap: invoiceIdByGuid,
        Rows, Alloc);
    Rep($"receipts: +{nRcp}   (unallocated line amount: {rcpUnalloc:N0})");

    // ── Phase 10: Payments (money out) — allocate to bills ──────────────────
    var (nPmt, pmtUnalloc) = await ImportMoneyAsync(
        db, companyId, PaymentDirection.Payment, "payments",
        contactGuidProp: "Supplier", contactMap: supplierIdByGuid, contactType: "Supplier",
        bankProp: "PaidFrom", bankNameByGuid: bankNameByGuid,
        lineDocProp: "PurchaseInvoice", docMap: billIdByGuid,
        Rows, Alloc);
    Rep($"payments: +{nPmt}   (unallocated line amount: {pmtUnalloc:N0})");

    // ── Phase 11: anchor AmountPaid to Manager's authoritative balanceDue ────
    // Manager receipts/payments include on-account amounts that don't map 1:1
    // to a specific document, so Σ(resolvable allocations) understates what was
    // actually paid. The list view's balanceDue IS the authoritative current
    // outstanding, so AmountPaid = invoiceTotal − balanceDue makes MyApp's AR/AP
    // match Manager exactly. The imported Payments + allocations remain as the
    // cash-ledger / drill-down (they may sum to less than AmountPaid = the
    // on-account remainder).
    int invPaidCount = 0, billPaidCount = 0;
    var invoices = await db.Invoices.Where(i => i.CompanyId == companyId && i.ExternalRef != null).ToListAsync();
    foreach (var inv in invoices)
    {
        var key = inv.ExternalRef!.StartsWith("mgr-sinv:") ? inv.ExternalRef!["mgr-sinv:".Length..] : null;
        if (key != null && invAmountByGuid.TryGetValue(key, out var m)) { inv.AmountPaid = m.total - m.balance; invPaidCount++; }
    }
    var bills = await db.PurchaseBills.Where(p => p.CompanyId == companyId && p.ExternalRef != null).ToListAsync();
    foreach (var b in bills)
    {
        var key = b.ExternalRef!.StartsWith("mgr-pinv:") ? b.ExternalRef!["mgr-pinv:".Length..] : null;
        if (key != null && billAmountByGuid.TryGetValue(key, out var m)) { b.AmountPaid = m.total - m.balance; billPaidCount++; }
    }
    await db.SaveChangesAsync();
    Rep($"AmountPaid anchored to Manager balance: invoices {invPaidCount}, bills {billPaidCount}");

    // ── Reconciliation ──────────────────────────────────────────────────────
    var arManager = invAmountByGuid.Values.Sum(v => v.balance);
    // Mirror MyApp's AR calc: sale invoices only (exclude credit/debit notes).
    var arMyapp = await db.Invoices.Where(i => i.CompanyId == companyId && i.DocumentType != 9 && i.DocumentType != 10).SumAsync(i => i.GrandTotal - i.AmountPaid);
    var salesTotal = await db.Invoices.Where(i => i.CompanyId == companyId && i.DocumentType != 9 && i.DocumentType != 10).SumAsync(i => i.GrandTotal);
    var apManager = billAmountByGuid.Values.Sum(v => v.balance);
    var apMyapp = await db.PurchaseBills.Where(p => p.CompanyId == companyId).SumAsync(p => p.GrandTotal - p.AmountPaid);
    Console.WriteLine();
    Console.WriteLine("== RECONCILIATION ==");
    Console.WriteLine($"   Sales invoiced total (MyApp):   {salesTotal,18:N2}");
    Console.WriteLine($"   AR outstanding  Manager/MyApp:  {arManager,18:N2} / {arMyapp,14:N2}");
    Console.WriteLine($"   AP outstanding  Manager/MyApp:  {apManager,18:N2} / {apMyapp,14:N2}");
    Console.WriteLine("   (AR/AP gaps are expected where receipts/payments were on-account / not doc-linked.)");

    if (dryRun) { await tx.RollbackAsync(); Console.WriteLine("\nDRY RUN — transaction rolled back, nothing persisted."); }
    else { await tx.CommitAsync(); Console.WriteLine("\nCOMMITTED."); }
    return 0;
}
catch (Exception ex)
{
    await tx.RollbackAsync();
    Console.Error.WriteLine("\nFAILED — rolled back.\n" + ex);
    return 1;
}

// ── Generic money-document importer (receipt/payment) ───────────────────────
static async Task<(int created, decimal unallocated)> ImportMoneyAsync(
    AppDbContext db, int companyId, PaymentDirection dir, string entity,
    string? contactGuidProp, Dictionary<string, int> contactMap, string contactType,
    string bankProp, Dictionary<string, string> bankNameByGuid,
    string lineDocProp, Dictionary<string, int> docMap,
    Func<string, bool, IEnumerable<JsonElement>> rows, Func<string, int, bool, int> alloc)
{
    int created = 0; decimal unallocated = 0m;
    bool isReceipt = dir == PaymentDirection.Receipt;
    foreach (var h in rows(entity, true))
    {
        // Contact: receipts carry the customer on each line (AccountsReceivableCustomer);
        // payments carry Supplier at header. Resolve best-effort.
        int contactId = 0;
        if (contactGuidProp != null && Str(h, contactGuidProp) is { } cg && contactMap.TryGetValue(cg, out var ci)) contactId = ci;

        var allocs = new List<PaymentAllocation>();
        decimal amount = 0m, lineUnalloc = 0m;
        if (h.TryGetProperty("Lines", out var L) && L.ValueKind == JsonValueKind.Array)
            foreach (var ln in L.EnumerateArray())
            {
                var amt = Money(ln, "Amount"); amount += amt;
                if (contactId == 0)
                {
                    var custG = Str(ln, "AccountsReceivableCustomer");
                    if (custG != null && contactMap.TryGetValue(custG, out var lc)) contactId = lc;
                }
                var docG = Str(ln, lineDocProp);
                if (docG != null && docMap.TryGetValue(docG, out var docId) && amt > 0)
                    allocs.Add(new PaymentAllocation { InvoiceId = isReceipt ? docId : (int?)null, PurchaseBillId = isReceipt ? (int?)null : docId, Amount = amt });
                else lineUnalloc += amt;
            }
        if (amount <= 0) continue;

        int num = alloc($"pay:{(int)dir}", RefNum(h), true);
        var bankG = Str(h, bankProp);
        var payment = new Payment
        {
            CompanyId = companyId, Direction = dir, Number = num, Date = Date(h, "Date") ?? DateTime.Today,
            ContactType = contactId != 0 ? contactType : "Other", ContactId = contactId != 0 ? contactId : (int?)null,
            BankAccountName = bankG != null ? bankNameByGuid.GetValueOrDefault(bankG) : null,
            Method = "Cash", Description = Str(h, "Description"), Amount = amount, Allocations = allocs,
        };
        db.Payments.Add(payment); created++; unallocated += lineUnalloc;
    }
    await db.SaveChangesAsync(); db.ChangeTracker.Clear();
    return (created, unallocated);

    static string? Str(JsonElement e, string p) =>
        e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static decimal Money(JsonElement e, string p)
    {
        if (!e.TryGetProperty(p, out var v)) return 0m;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDecimal();
        if (v.ValueKind == JsonValueKind.Object && v.TryGetProperty("value", out var val) && val.ValueKind == JsonValueKind.Number) return val.GetDecimal();
        return 0m;
    }
    static DateTime? Date(JsonElement e, string p) =>
        DateTime.TryParse(Str(e, p), CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
    static int RefNum(JsonElement e) =>
        int.TryParse(Str(e, "Reference")?.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;
}

// ── --fresh: delete a company's imported data (child-first) ─────────────────
static async Task WipeCompanyAsync(AppDbContext db, int companyId)
{
    await db.PaymentAllocations.Where(a => a.Payment.CompanyId == companyId).ExecuteDeleteAsync();
    await db.Payments.Where(p => p.CompanyId == companyId).ExecuteDeleteAsync();
    await db.InvoiceItems.Where(ii => ii.Invoice!.CompanyId == companyId).ExecuteDeleteAsync();
    await db.Invoices.Where(i => i.CompanyId == companyId).ExecuteDeleteAsync();
    await db.PurchaseItems.Where(pi => pi.PurchaseBill!.CompanyId == companyId).ExecuteDeleteAsync();
    await db.PurchaseBills.Where(p => p.CompanyId == companyId).ExecuteDeleteAsync();
    await db.DeliveryItems.Where(di => di.DeliveryChallan!.CompanyId == companyId).ExecuteDeleteAsync();
    await db.DeliveryChallans.Where(c => c.CompanyId == companyId).ExecuteDeleteAsync();
    await db.SalesQuoteItems.Where(qi => qi.SalesQuote!.CompanyId == companyId).ExecuteDeleteAsync();
    await db.SalesQuotes.Where(q => q.CompanyId == companyId).ExecuteDeleteAsync();
    await db.SalesOrderItems.Where(oi => oi.SalesOrder!.CompanyId == companyId).ExecuteDeleteAsync();
    await db.SalesOrders.Where(o => o.CompanyId == companyId).ExecuteDeleteAsync();
    await db.Clients.Where(c => c.CompanyId == companyId).ExecuteDeleteAsync();
    await db.Suppliers.Where(s => s.CompanyId == companyId).ExecuteDeleteAsync();
    await db.Divisions.Where(d => d.CompanyId == companyId).ExecuteDeleteAsync();
}
