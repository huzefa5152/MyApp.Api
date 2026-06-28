using System.Diagnostics;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Reads the legacy Data_2021 DB (read-only) and writes masters into a MyApp
    /// company. CoA structure maps via the ControlAccountCode chain; the two big
    /// party-ledger controls (201 Accounts Payable, 303 Accounts Receivable) are
    /// the customer/supplier subledger, so their leaves are NOT imported as
    /// accounts — the Traders become Client/Supplier rows instead (design §14 #4).
    /// </summary>
    public class LegacyImportService : ILegacyImportService
    {
        private readonly AppDbContext _db;
        private readonly IAccountService _coa;
        private readonly ILogger<LegacyImportService> _logger;
        // Base connection (server + auth) taken from DefaultConnection; the
        // active read connection (_connStr) is built per-run pointing at the
        // restored backup DB. Service is scoped, so the mutable field is safe.
        private readonly string? _baseConn;
        private string? _connStr;

        // Temp restore DBs are named with this prefix; reads are restricted to
        // names matching it so a forged "source" can't point at another DB.
        private const string TempDbPrefix = "MyApp_LegacyImport_";
        private static readonly Regex TempDbPattern = new($"^{TempDbPrefix}[0-9A-Za-z_]+$", RegexOptions.Compiled);

        // Legacy control-account codes whose children are ledger PARTIES (not
        // sub-accounts). Imported as Client/Supplier, not as Accounts.
        private static readonly HashSet<string> PartyControlCodes = new() { "201", "303" };

        // legacy AccountType -> (our AccountType, statement)
        private static readonly Dictionary<string, (string type, string stmt)> TypeMap = new()
        {
            ["A"] = ("Asset", "BalanceSheet"),
            ["L"] = ("Liability", "BalanceSheet"),
            ["C"] = ("Equity", "BalanceSheet"),
            ["R"] = ("Income", "ProfitAndLoss"),
            ["E"] = ("Expense", "ProfitAndLoss"),
        };

        public LegacyImportService(AppDbContext db, IAccountService coa,
            IConfiguration config, ILogger<LegacyImportService> logger)
        {
            _db = db;
            _coa = coa;
            _logger = logger;
            _baseConn = config.GetConnectionString("DefaultConnection")
                     ?? config.GetConnectionString("LegacyDb");
        }

        // Configured = we can reach a SQL Server (to restore into / read from).
        public bool IsConfigured => !string.IsNullOrWhiteSpace(_baseConn);

        // Point the read helpers at a restored backup DB for the rest of this
        // request. Validates the name so callers can't read an arbitrary DB.
        private void UseSource(string? sourceDb)
        {
            if (string.IsNullOrWhiteSpace(sourceDb) || !TempDbPattern.IsMatch(sourceDb))
                throw new InvalidOperationException("Invalid or missing backup source. Upload a backup first.");
            _connStr = new SqlConnectionStringBuilder(_baseConn) { InitialCatalog = sourceDb }.ConnectionString;
        }

        private string MasterConnStr() =>
            new SqlConnectionStringBuilder(_baseConn) { InitialCatalog = "master" }.ConnectionString;

        // ── Backup restore / inspect / cleanup (dev-only ETL source) ────────────

        /// <summary>Restore an uploaded .bak into a fresh temp DB on the same SQL
        /// instance and return its name + a content summary. The .bak is written
        /// to the instance's default data dir (which the SQL service account can
        /// always read), then deleted after the restore.</summary>
        public async Task<BackupRestoreResult> RestoreBackupAsync(Stream bak, string fileName)
        {
            if (!IsConfigured) throw new InvalidOperationException("No SQL Server is configured for restore.");

            var master = MasterConnStr();
            string dataDir = await ScalarAsync(master, "SELECT CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultDataPath'))")
                             ?? throw new InvalidOperationException("Could not resolve the SQL data directory.");
            if (!dataDir.EndsWith("\\")) dataDir += "\\";

            // Stage the .bak in a neutral dir under ProgramData: the app (running
            // as the operator) can write here, and we grant "Authenticated Users"
            // read so the SQL Server service account can read it for RESTORE.
            // (SQL's own data dir under Program Files denies the app write access.)
            var stamp = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
            var stageDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "MyApp", "legacy-import");
            Directory.CreateDirectory(stageDir);
            GrantSqlReadAccess(stageDir);
            var bakPath = Path.Combine(stageDir, $"upload_{stamp}.bak");
            await using (var fs = File.Create(bakPath)) await bak.CopyToAsync(fs);

            var dbName = $"{TempDbPrefix}{stamp}";
            try
            {
                // Logical file names → MOVE clauses.
                var files = new List<(string Logical, string Type)>();
                await using (var conn = new SqlConnection(master))
                {
                    await conn.OpenAsync();
                    await using var cmd = conn.CreateCommand();
                    cmd.CommandText = "RESTORE FILELISTONLY FROM DISK = @p";
                    cmd.Parameters.AddWithValue("@p", bakPath);
                    await using var rdr = await cmd.ExecuteReaderAsync();
                    while (await rdr.ReadAsync())
                        files.Add((rdr["LogicalName"].ToString()!, rdr["Type"].ToString()!.Trim()));
                }
                if (files.Count == 0) throw new InvalidOperationException("The backup contains no files (not a valid .bak?).");

                var moves = files.Select((f, i) =>
                {
                    var ext = f.Type == "L" ? ".ldf" : (i == 0 ? ".mdf" : $"_{i}.ndf");
                    return $"MOVE '{f.Logical.Replace("'", "''")}' TO '{dataDir}{dbName}_{i}{ext}'";
                });

                await using (var conn = new SqlConnection(master))
                {
                    await conn.OpenAsync();
                    await using var cmd = conn.CreateCommand();
                    cmd.CommandTimeout = 600;
                    cmd.CommandText = $"RESTORE DATABASE [{dbName}] FROM DISK = @p WITH {string.Join(", ", moves)}, REPLACE, RECOVERY";
                    cmd.Parameters.AddWithValue("@p", bakPath);
                    await cmd.ExecuteNonQueryAsync();
                }
            }
            finally
            {
                try { File.Delete(bakPath); } catch { /* best-effort */ }
            }

            UseSource(dbName);
            var summary = ReadSummary();
            summary.SourceDb = dbName;
            return summary;
        }

        /// <summary>Drop a temp restore DB (validated name only).</summary>
        public async Task CleanupAsync(string sourceDb)
        {
            if (string.IsNullOrWhiteSpace(sourceDb) || !TempDbPattern.IsMatch(sourceDb))
                throw new InvalidOperationException("Invalid backup source name.");
            await using var conn = new SqlConnection(MasterConnStr());
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                $"IF DB_ID(@db) IS NOT NULL BEGIN " +
                $"ALTER DATABASE [{sourceDb}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{sourceDb}]; END";
            cmd.Parameters.AddWithValue("@db", sourceDb);
            await cmd.ExecuteNonQueryAsync();
        }

        // Grant the SQL Server service account (via the Authenticated Users SID
        // S-1-5-11) read+traverse on the staging dir so RESTORE can read the
        // uploaded .bak. Best-effort; logged if it fails.
        private void GrantSqlReadAccess(string dir)
        {
            try
            {
                var psi = new ProcessStartInfo("icacls", $"\"{dir}\" /grant *S-1-5-11:(OI)(CI)RX")
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
                using var p = Process.Start(psi);
                p?.WaitForExit(15000);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "icacls grant on {Dir} failed (RESTORE may fail if SQL can't read the staged backup).", dir);
            }
        }

        private async Task<string?> ScalarAsync(string connStr, string sql)
        {
            await using var conn = new SqlConnection(connStr);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            var v = await cmd.ExecuteScalarAsync();
            return v == null || v == DBNull.Value ? null : v.ToString();
        }

        // Quick content summary for the confirmation screen (cost centre name,
        // divisions/CompanyProfiles, doc counts). Uses the active _connStr.
        private BackupRestoreResult ReadSummary()
        {
            var r = new BackupRestoreResult();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT TOP 1 Name FROM CostCentre WHERE CostCentreID = 1";
                r.CostCentreName = cmd.ExecuteScalar()?.ToString()?.Trim();
            }
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT Name FROM CompanyProfile WHERE FKCostCentreID = 1 ORDER BY CompanyID";
                using var rdr = cmd.ExecuteReader();
                while (rdr.Read()) r.Divisions.Add(rdr.GetString(0).Trim());
            }
            int Count(string sql) { using var c = conn.CreateCommand(); c.CommandText = sql; return Convert.ToInt32(c.ExecuteScalar()); }
            r.SalesInvoices = Count("SELECT COUNT(*) FROM SalesInvoiceMaster WHERE FKCostCentreID = 1");
            r.SalesQuotes = Count("SELECT COUNT(*) FROM QuotationMaster WHERE FKCostCentreID = 1");
            r.PurchaseBills = Count("SELECT COUNT(*) FROM PurchaseMaster WHERE FKCostCentreID = 1");
            return r;
        }

        // ── Masters ─────────────────────────────────────────────────────────────

        public async Task<LegacyImportResult> ImportMastersAsync(string sourceDb, int companyId)
        {
            UseSource(sourceDb);
            var company = await _db.Companies.FirstOrDefaultAsync(c => c.Id == companyId)
                ?? throw new InvalidOperationException("Target company not found.");

            var result = new LegacyImportResult();

            // Migration defaults for the target company: FBR off (historical data
            // is never re-submitted), inventory tracking on, tenant/user-access
            // restriction on. Idempotent — re-running just re-asserts them.
            company.FbrEnabled = false;
            company.InventoryTrackingEnabled = true;
            company.IsTenantIsolated = true;
            await _db.SaveChangesAsync();
            result.Notes.Add("Target company set to: FBR integration OFF, inventory tracking ON, user-access restriction (tenant isolation) ON.");

            // First migration: drop the shipped seed item types so the catalog
            // isn't cluttered by the starter set (migrated lines are free-text).
            var removedSeeds = await ItemTypeSeeder.RemoveSeedItemTypesAsync(_db);
            result.Created["seedItemTypesRemoved"] = removedSeeds;
            if (removedSeeds > 0) result.Notes.Add($"Removed {removedSeeds} seed item type(s) from the catalog.");

            await ImportDivisionsAsync(companyId, result);
            var coa = ReadCoa();
            await ImportCoaAsync(companyId, coa, result);
            await ImportPartiesAsync(companyId, coa, result);
            return result;
        }

        // ── Divisions (legacy CompanyProfile → Division) ────────────────────────

        /// <summary>Each CompanyProfile under the cost centre becomes a Division
        /// of the target company. Idempotent by Name (unique per company).</summary>
        private async Task ImportDivisionsAsync(int companyId, LegacyImportResult result)
        {
            var profiles = ReadCompanyProfiles();
            var existingNames = await _db.Divisions
                .Where(d => d.CompanyId == companyId)
                .Select(d => d.Name).ToListAsync();
            var have = new HashSet<string>(existingNames, StringComparer.OrdinalIgnoreCase);

            int created = 0, skipped = 0;
            foreach (var p in profiles)
            {
                var name = string.IsNullOrWhiteSpace(p.Name) ? (p.ShortName ?? $"Division {p.CompanyId}") : p.Name.Trim();
                if (have.Contains(name)) { skipped++; continue; }
                _db.Divisions.Add(new Division
                {
                    CompanyId = companyId,
                    Name = name,
                    BrandName = string.IsNullOrWhiteSpace(p.ShortName) ? null : p.ShortName.Trim(),
                    FullAddress = string.IsNullOrWhiteSpace(p.Address) ? null : p.Address.Trim(),
                    NTN = string.IsNullOrWhiteSpace(p.Ntn) ? null : p.Ntn.Trim(),
                    STRN = string.IsNullOrWhiteSpace(p.Gst) ? null : p.Gst.Trim(),
                });
                have.Add(name); created++;
            }
            await _db.SaveChangesAsync();
            result.Created["divisions"] = created;
            result.Skipped["divisionsAlreadyImported"] = skipped;
        }

        /// <summary>Map legacy CompanyProfile.CompanyID → our DivisionId, matched
        /// on the division Name we created above.</summary>
        private async Task<Dictionary<int, int>> BuildDivisionMapAsync(int companyId)
        {
            var profiles = ReadCompanyProfiles();
            var divByName = await _db.Divisions
                .Where(d => d.CompanyId == companyId)
                .ToDictionaryAsync(d => d.Name, d => d.Id, StringComparer.OrdinalIgnoreCase);
            var map = new Dictionary<int, int>();
            foreach (var p in profiles)
            {
                var name = string.IsNullOrWhiteSpace(p.Name) ? (p.ShortName ?? $"Division {p.CompanyId}") : p.Name.Trim();
                if (divByName.TryGetValue(name, out var id)) map[p.CompanyId] = id;
            }
            return map;
        }

        // ── Chart of Accounts ───────────────────────────────────────────────────

        private async Task ImportCoaAsync(int companyId, List<CoaRow> rows, LegacyImportResult result)
        {
            var groupIdByCode = new Dictionary<string, int>();
            var createdGroups = 0;
            var createdAccounts = 0;

            // Roots (no parent) -> statement groups.
            foreach (var r in rows.Where(r => r.Parent == null))
            {
                var (_, stmt) = TypeMap[r.Type];
                var g = await _coa.CreateGroupAsync(companyId, new CreateAccountGroupDto
                { Name = r.Desc, Statement = stmt, ExternalRef = r.Code });
                groupIdByCode[r.Code] = g.Id;
                createdGroups++;
            }

            // Other control accounts -> nested groups (parents first; multi-pass).
            var pending = rows.Where(r => r.IsControl && r.Parent != null).ToList();
            var guard = 0;
            while (pending.Count > 0 && guard++ < 50)
            {
                var still = new List<CoaRow>();
                var progressed = false;
                foreach (var r in pending)
                {
                    if (!groupIdByCode.TryGetValue(r.Parent!, out var parentId)) { still.Add(r); continue; }
                    var g = await _coa.CreateGroupAsync(companyId, new CreateAccountGroupDto
                    { Name = r.Desc, ParentGroupId = parentId, ExternalRef = r.Code });
                    groupIdByCode[r.Code] = g.Id;
                    createdGroups++;
                    progressed = true;
                }
                pending = still;
                if (!progressed) break;
            }

            // Leaf accounts -> their parent group, EXCEPT party ledgers (those
            // become Client/Supplier). Opening balance from OpeningDebit/Credit.
            foreach (var r in rows.Where(r => !r.IsControl && r.Parent != null))
            {
                if (PartyControlCodes.Contains(r.Parent!)) continue;       // party ledger → subledger
                if (!groupIdByCode.TryGetValue(r.Parent!, out var gid)) continue;
                var (type, _) = TypeMap[r.Type];
                var isDebit = r.OpeningDebit >= r.OpeningCredit;
                await _coa.CreateAccountAsync(companyId, new CreateAccountDto
                {
                    Name = r.Desc,
                    Code = r.Code,
                    AccountGroupId = gid,
                    AccountType = type,
                    OpeningBalance = isDebit ? r.OpeningDebit : r.OpeningCredit,
                    OpeningBalanceIsDebit = isDebit,
                    ExternalRef = r.Code,
                });
                createdAccounts++;
            }

            result.Created["coaGroups"] = createdGroups;
            result.Created["coaAccounts"] = createdAccounts;
            result.Notes.Add($"Skipped party ledgers under {string.Join(", ", PartyControlCodes)} (imported as Client/Supplier).");
        }

        // ── Parties ─────────────────────────────────────────────────────────────

        private async Task ImportPartiesAsync(int companyId, List<CoaRow> coa, LegacyImportResult result)
        {
            // A trader is a Client or Supplier based on WHICH control account its
            // ledger sits under — NOT FKTraderTypeID, which this dataset files
            // inconsistently (a sales customer like "CHINA STATE" is type 2). The
            // authoritative signal: the root of its FKAccountCode chain — Asset
            // (receivable) ⇒ Client, Liability (payable) ⇒ Supplier.
            var parentByCode = coa.ToDictionary(r => r.Code, r => r.Parent);
            var typeByCode = coa.ToDictionary(r => r.Code, r => r.Type);
            string? RootType(string? code)
            {
                var guard = 0;
                while (code != null && parentByCode.TryGetValue(code, out var parent) && guard++ < 50)
                {
                    if (parent == null) return typeByCode.GetValueOrDefault(code);
                    code = parent;
                }
                return code != null ? typeByCode.GetValueOrDefault(code) : null;
            }

            var traders = ReadTraders();
            // Existing imported refs for idempotency.
            var existingClients = await _db.Clients
                .Where(c => c.CompanyId == companyId && c.ExternalRef != null)
                .Select(c => c.ExternalRef!).ToListAsync();
            var existingSuppliers = await _db.Suppliers
                .Where(s => s.CompanyId == companyId && s.ExternalRef != null)
                .Select(s => s.ExternalRef!).ToListAsync();
            var clientRefs = new HashSet<string>(existingClients);
            var supplierRefs = new HashSet<string>(existingSuppliers);

            int newClients = 0, newSuppliers = 0, skipped = 0, unclassified = 0;
            foreach (var t in traders)
            {
                var er = $"trader:{t.Id}";
                var name = string.IsNullOrWhiteSpace(t.Name) ? $"(trader {t.Id})" : t.Name.Trim();
                var root = RootType(t.AccountCode);   // "A" (asset/receivable) | "L" (liability/payable) | …
                if (root == "A")
                {
                    if (clientRefs.Contains(er)) { skipped++; continue; }
                    _db.Clients.Add(new Client { CompanyId = companyId, Name = name, NTN = t.Ntn, STRN = t.Gst, ExternalRef = er });
                    clientRefs.Add(er); newClients++;
                }
                else if (root == "L")
                {
                    if (supplierRefs.Contains(er)) { skipped++; continue; }
                    _db.Suppliers.Add(new Supplier { CompanyId = companyId, Name = name, NTN = t.Ntn, STRN = t.Gst, ExternalRef = er });
                    supplierRefs.Add(er); newSuppliers++;
                }
                else { unclassified++; }
            }
            await _db.SaveChangesAsync();

            result.Created["clients"] = newClients;
            result.Created["suppliers"] = newSuppliers;
            result.Skipped["partiesAlreadyImported"] = skipped;
            result.Notes.Add("Parties classified by ledger control account (Asset→Client, Liability→Supplier), not FKTraderTypeID.");
            if (unclassified > 0) result.Notes.Add($"Skipped {unclassified} traders whose account doesn't roll up to an asset/liability (no trade ledger).");
        }

        // ── Documents (sales invoices + purchase bills) ─────────────────────────

        public async Task<LegacyImportResult> ImportDocumentsAsync(string sourceDb, int companyId)
        {
            UseSource(sourceDb);
            if (!await _db.Companies.AnyAsync(c => c.Id == companyId))
                throw new InvalidOperationException("Target company not found.");

            // Map legacy keys -> our imported masters.
            var traders = ReadTraders();
            var clientByRef = await _db.Clients.Where(c => c.CompanyId == companyId && c.ExternalRef != null)
                .ToDictionaryAsync(c => c.ExternalRef!, c => c.Id);
            var supplierByRef = await _db.Suppliers.Where(s => s.CompanyId == companyId && s.ExternalRef != null)
                .ToDictionaryAsync(s => s.ExternalRef!, s => s.Id);
            var clientIdByAccount = new Dictionary<string, int>();
            var clientIdByTrader = new Dictionary<int, int>();
            var supplierIdByTrader = new Dictionary<int, int>();
            foreach (var t in traders)
            {
                if (clientByRef.TryGetValue($"trader:{t.Id}", out var cid))
                {
                    clientIdByTrader[t.Id] = cid;
                    if (t.AccountCode != null) clientIdByAccount[t.AccountCode] = cid;
                }
                if (supplierByRef.TryGetValue($"trader:{t.Id}", out var sid))
                    supplierIdByTrader[t.Id] = sid;
            }

            // Legacy FKCompanyID (CompanyProfile) -> our DivisionId.
            var divisionMap = await BuildDivisionMapAsync(companyId);

            var result = new LegacyImportResult();
            await ImportSalesAsync(companyId, clientIdByAccount, divisionMap, result);
            await ImportQuotesAsync(companyId, clientIdByTrader, divisionMap, result);
            await ImportSalesOrdersAsync(companyId, clientIdByTrader, divisionMap, result);
            await ImportChallansAsync(companyId, clientIdByTrader, divisionMap, result);
            await ImportPurchasesAsync(companyId, supplierIdByTrader, result);
            await SeedStartingNumbersAsync(companyId, result);
            return result;
        }

        private async Task ImportSalesAsync(int companyId, Dictionary<string, int> clientIdByAccount, Dictionary<int, int> divisionMap, LegacyImportResult result)
        {
            var headers = ReadSaleHeaders();
            var folioCount = headers.GroupBy(h => h.Folio).ToDictionary(g => g.Key, g => g.Count());
            var custDebits = ReadVoucherTraderLines(debit: true);   // folio -> [(account, amount)]
            var detail = ReadDocDetail("SalesInvoiceDetail");        // doc -> lines

            var existing = await _db.Invoices.Where(i => i.CompanyId == companyId && i.ExternalRef != null)
                .Select(i => i.ExternalRef!).ToListAsync();
            var existingRefs = new HashSet<string>(existing);

            int created = 0, skippedExisting = 0, skippedSharedFolio = 0, skippedNoCustomer = 0;
            foreach (var h in headers)
            {
                // Namespace the ref by legacy company so the same DocumentNumber
                // in two divisions doesn't collide on idempotency.
                var er = $"sinv:{h.CompanyId}:{h.Doc}";
                if (existingRefs.Contains(er)) { skippedExisting++; continue; }
                // Shared folios can't attribute the AR debit to one invoice — skip.
                if (folioCount.GetValueOrDefault(h.Folio) != 1) { skippedSharedFolio++; continue; }

                var lines = custDebits.GetValueOrDefault(h.Folio) ?? new();
                var custLines = lines.Where(l => clientIdByAccount.ContainsKey(l.Account)).ToList();
                var distinctClients = custLines.Select(l => clientIdByAccount[l.Account]).Distinct().ToList();
                if (distinctClients.Count != 1) { skippedNoCustomer++; continue; }

                var total = custLines.Sum(l => l.Amount);          // GL-anchored billed amount
                var gst = h.Tax;
                var subtotal = total - gst;
                var inv = new Invoice
                {
                    CompanyId = companyId,
                    ClientId = distinctClients[0],
                    DivisionId = divisionMap.TryGetValue(h.CompanyId, out var invDiv) ? invDiv : (int?)null,
                    InvoiceNumber = h.Doc,
                    Date = h.Date,
                    Subtotal = subtotal,
                    GSTRate = subtotal > 0 ? Math.Round(gst / subtotal * 100, 2) : 0,
                    GSTAmount = gst,
                    GrandTotal = total,
                    AmountInWords = "",
                    IsMigrated = true,
                    IsFbrExcluded = true,
                    ExternalRef = er,
                    Items = (detail.GetValueOrDefault(h.Doc) ?? new()).Select(d => new InvoiceItem
                    {
                        Description = d.Desc,
                        Quantity = d.Qty,
                        UOM = "",
                        UnitPrice = d.Price,
                        LineTotal = Math.Round(d.Qty * d.Price, 2),
                    }).ToList(),
                };
                _db.Invoices.Add(inv);
                created++;
            }
            await _db.SaveChangesAsync();

            result.Created["salesInvoices"] = created;
            result.Skipped["salesAlreadyImported"] = skippedExisting;
            if (skippedSharedFolio > 0) result.Notes.Add($"Skipped {skippedSharedFolio} sales invoices on shared folios (can't attribute the GL customer line — e.g. opening-balance batch).");
            if (skippedNoCustomer > 0) result.Notes.Add($"Skipped {skippedNoCustomer} sales invoices with no single GL customer match.");
        }

        // ── Sales quotes (NEW — QuotationMaster/Detail) ─────────────────────────
        private async Task ImportQuotesAsync(int companyId,
            Dictionary<int, int> clientIdByTrader, Dictionary<int, int> divisionMap, LegacyImportResult result)
        {
            var headers = ReadQuoteHeaders();
            var detail = ReadDocDetail("QuotationDetail");

            // SalesQuote has no ExternalRef — dedup on (DivisionId, QuoteNumber),
            // which mirrors the unique index.
            var existing = await _db.SalesQuotes.Where(q => q.CompanyId == companyId)
                .Select(q => new { q.DivisionId, q.QuoteNumber }).ToListAsync();
            var existingKeys = new HashSet<(int?, int)>(existing.Select(e => (e.DivisionId, e.QuoteNumber)));

            int created = 0, skippedExisting = 0, skippedNoClient = 0;
            foreach (var h in headers)
            {
                int? divId = divisionMap.TryGetValue(h.CompanyId, out var dv) ? dv : (int?)null;
                if (existingKeys.Contains((divId, h.Doc))) { skippedExisting++; continue; }
                // Quote customer = the contact person, which in this schema is a
                // Trader id; only import when it resolved to a Client.
                if (!clientIdByTrader.TryGetValue(h.ContactId, out var clientId)) { skippedNoClient++; continue; }

                var lines = detail.GetValueOrDefault(h.Doc) ?? new();
                var subtotal = lines.Sum(d => Math.Round(d.Qty * d.Price, 2));
                _db.SalesQuotes.Add(new SalesQuote
                {
                    CompanyId = companyId,
                    DivisionId = divId,
                    ClientId = clientId,
                    QuoteNumber = h.Doc,
                    Date = h.Date,
                    ValidUntil = h.Expiry,
                    Subtotal = subtotal,
                    GSTRate = 0,
                    GSTAmount = 0,
                    GrandTotal = subtotal,
                    AmountInWords = "",
                    Status = "Sent",
                    Items = lines.Select(d => new SalesQuoteItem
                    {
                        Description = d.Desc,
                        Quantity = d.Qty,
                        Unit = "",
                        UnitPrice = d.Price,
                        LineTotal = Math.Round(d.Qty * d.Price, 2),
                    }).ToList(),
                });
                existingKeys.Add((divId, h.Doc));
                created++;
            }
            await _db.SaveChangesAsync();

            result.Created["salesQuotes"] = created;
            result.Skipped["quotesAlreadyImported"] = skippedExisting;
            if (skippedNoClient > 0) result.Notes.Add($"Skipped {skippedNoClient} quotes whose customer (contact person) isn't an imported Client.");
        }

        // ── Sales orders (NEW — SalesOrderMaster/Detail) ────────────────────────
        private async Task ImportSalesOrdersAsync(int companyId,
            Dictionary<int, int> clientIdByTrader, Dictionary<int, int> divisionMap, LegacyImportResult result)
        {
            var headers = ReadSalesOrderHeaders();
            var detail = ReadDocDetail("SalesOrderDetail");

            // SalesOrder has no ExternalRef — dedup on (DivisionId, OrderNumber).
            var existing = await _db.SalesOrders.Where(o => o.CompanyId == companyId)
                .Select(o => new { o.DivisionId, o.SalesOrderNumber }).ToListAsync();
            var existingKeys = new HashSet<(int?, int)>(existing.Select(e => (e.DivisionId, e.SalesOrderNumber)));

            int created = 0, skippedExisting = 0, skippedNoClient = 0;
            foreach (var h in headers)
            {
                int? divId = divisionMap.TryGetValue(h.CompanyId, out var dv) ? dv : (int?)null;
                if (existingKeys.Contains((divId, h.Doc))) { skippedExisting++; continue; }
                if (!clientIdByTrader.TryGetValue(h.ContactId, out var clientId)) { skippedNoClient++; continue; }

                var lines = detail.GetValueOrDefault(h.Doc) ?? new();
                _db.SalesOrders.Add(new SalesOrder
                {
                    CompanyId = companyId,
                    DivisionId = divId,
                    ClientId = clientId,
                    SalesOrderNumber = h.Doc,
                    OrderDate = h.Date,
                    RequiredDate = h.Expected,
                    Status = "Open",
                    IsImported = true,
                    Items = lines.Select(d => new SalesOrderItem
                    {
                        Description = d.Desc,
                        Quantity = d.Qty,
                        Unit = "",
                    }).ToList(),
                });
                existingKeys.Add((divId, h.Doc));
                created++;
            }
            await _db.SaveChangesAsync();

            result.Created["salesOrders"] = created;
            result.Skipped["salesOrdersAlreadyImported"] = skippedExisting;
            if (skippedNoClient > 0) result.Notes.Add($"Skipped {skippedNoClient} sales orders whose customer (contact person) isn't an imported Client.");
        }

        // ── Delivery challans (NEW — DeliveryChallanMaster/Detail) ──────────────
        private async Task ImportChallansAsync(int companyId,
            Dictionary<int, int> clientIdByTrader, Dictionary<int, int> divisionMap, LegacyImportResult result)
        {
            var headers = ReadChallanHeaders();
            var detail = ReadDocDetail("DeliveryChallanDetail");

            // DeliveryChallan has no ExternalRef and challan numbers are non-unique
            // by design; dedup on (DivisionId, ChallanNumber) for idempotency.
            var existing = await _db.DeliveryChallans.Where(c => c.CompanyId == companyId)
                .Select(c => new { c.DivisionId, c.ChallanNumber }).ToListAsync();
            var existingKeys = new HashSet<(int?, int)>(existing.Select(e => (e.DivisionId, e.ChallanNumber)));

            int created = 0, skippedExisting = 0, skippedNoClient = 0;
            foreach (var h in headers)
            {
                int? divId = divisionMap.TryGetValue(h.CompanyId, out var dv) ? dv : (int?)null;
                if (existingKeys.Contains((divId, h.Doc))) { skippedExisting++; continue; }
                if (!clientIdByTrader.TryGetValue(h.ContactId, out var clientId)) { skippedNoClient++; continue; }

                var lines = detail.GetValueOrDefault(h.Doc) ?? new();
                _db.DeliveryChallans.Add(new DeliveryChallan
                {
                    CompanyId = companyId,
                    DivisionId = divId,
                    ClientId = clientId,
                    ChallanNumber = h.Doc,
                    PoNumber = h.Po ?? "",
                    DeliveryDate = h.Date,
                    Status = "Imported",
                    IsImported = true,
                    Items = lines.Select(d => new DeliveryItem
                    {
                        Description = d.Desc,
                        Quantity = d.Qty,
                        Unit = "",
                    }).ToList(),
                });
                existingKeys.Add((divId, h.Doc));
                created++;
            }
            await _db.SaveChangesAsync();

            result.Created["deliveryChallans"] = created;
            result.Skipped["challansAlreadyImported"] = skippedExisting;
            if (skippedNoClient > 0) result.Notes.Add($"Skipped {skippedNoClient} delivery challans whose customer (contact person) isn't an imported Client.");
        }

        // ── Per-division / company document starting numbers ────────────────────
        // The next document continues from the legacy sequence: Starting* is set
        // to (imported max + 1) so the config screen shows the next number to use,
        // and Current* to the imported max. Covers sales quote / invoice / challan
        // per division, and purchase bill at company level (purchases carry no
        // division). Only raises values (never lowers an operator-set number).
        private async Task SeedStartingNumbersAsync(int companyId, LegacyImportResult result)
        {
            var invByDiv = await _db.Invoices.Where(i => i.CompanyId == companyId && i.DivisionId != null)
                .GroupBy(i => i.DivisionId!.Value)
                .Select(g => new { Div = g.Key, Max = g.Max(x => x.InvoiceNumber) }).ToDictionaryAsync(x => x.Div, x => x.Max);
            var quoteByDiv = await _db.SalesQuotes.Where(q => q.CompanyId == companyId && q.DivisionId != null)
                .GroupBy(q => q.DivisionId!.Value)
                .Select(g => new { Div = g.Key, Max = g.Max(x => x.QuoteNumber) }).ToDictionaryAsync(x => x.Div, x => x.Max);
            var challanByDiv = await _db.DeliveryChallans.Where(c => c.CompanyId == companyId && c.DivisionId != null)
                .GroupBy(c => c.DivisionId!.Value)
                .Select(g => new { Div = g.Key, Max = g.Max(x => x.ChallanNumber) }).ToDictionaryAsync(x => x.Div, x => x.Max);
            var orderByDiv = await _db.SalesOrders.Where(o => o.CompanyId == companyId && o.DivisionId != null)
                .GroupBy(o => o.DivisionId!.Value)
                .Select(g => new { Div = g.Key, Max = g.Max(x => x.SalesOrderNumber) }).ToDictionaryAsync(x => x.Div, x => x.Max);

            // Set Starting = max+1, Current = max (only when it raises the value).
            static void Seed(int max, ref int starting, ref int current)
            {
                if (max <= 0) return;
                if (max + 1 > starting) starting = max + 1;
                if (max > current) current = max;
            }

            var divisions = await _db.Divisions.Where(d => d.CompanyId == companyId).ToListAsync();
            foreach (var d in divisions)
            {
                var s = d.StartingInvoiceNumber; var c = d.CurrentInvoiceNumber;
                Seed(invByDiv.GetValueOrDefault(d.Id), ref s, ref c); d.StartingInvoiceNumber = s; d.CurrentInvoiceNumber = c;
                s = d.StartingSalesQuoteNumber; c = d.CurrentSalesQuoteNumber;
                Seed(quoteByDiv.GetValueOrDefault(d.Id), ref s, ref c); d.StartingSalesQuoteNumber = s; d.CurrentSalesQuoteNumber = c;
                s = d.StartingChallanNumber; c = d.CurrentChallanNumber;
                Seed(challanByDiv.GetValueOrDefault(d.Id), ref s, ref c); d.StartingChallanNumber = s; d.CurrentChallanNumber = c;
                s = d.StartingSalesOrderNumber; c = d.CurrentSalesOrderNumber;
                Seed(orderByDiv.GetValueOrDefault(d.Id), ref s, ref c); d.StartingSalesOrderNumber = s; d.CurrentSalesOrderNumber = c;
            }

            var company = await _db.Companies.FirstAsync(c => c.Id == companyId);
            var billMax = await _db.PurchaseBills.Where(p => p.CompanyId == companyId).MaxAsync(p => (int?)p.PurchaseBillNumber) ?? 0;
            { var s = company.StartingPurchaseBillNumber; var c = company.CurrentPurchaseBillNumber; Seed(billMax, ref s, ref c); company.StartingPurchaseBillNumber = s; company.CurrentPurchaseBillNumber = c; }
            // Company-level (no-division) fallbacks for sales docs, if any exist.
            var invCoMax = await _db.Invoices.Where(i => i.CompanyId == companyId && i.DivisionId == null).MaxAsync(i => (int?)i.InvoiceNumber) ?? 0;
            { var s = company.StartingInvoiceNumber; var c = company.CurrentInvoiceNumber; Seed(invCoMax, ref s, ref c); company.StartingInvoiceNumber = s; company.CurrentInvoiceNumber = c; }

            await _db.SaveChangesAsync();
            result.Created["divisionsNumbered"] = divisions.Count;
            result.Notes.Add("Seeded next (max+1) sales-quote / sales-order / invoice / delivery-challan numbers per division and the company's next purchase-bill number from the imported data — adjust in Company/Division config if a stray legacy number looks too high.");
        }

        private async Task ImportPurchasesAsync(int companyId, Dictionary<int, int> supplierIdByTrader, LegacyImportResult result)
        {
            var headers = ReadPurchaseHeaders();
            var folioCount = headers.GroupBy(h => h.Folio).ToDictionary(g => g.Key, g => g.Count());
            var credits = ReadVoucherTraderLines(debit: false);     // folio -> [(account, amount)]
            var traderAccount = ReadTraders().Where(t => t.AccountCode != null)
                .GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First().AccountCode!);
            var detail = ReadDocDetail("PurchaseDetail");

            var existing = await _db.PurchaseBills.Where(p => p.CompanyId == companyId && p.ExternalRef != null)
                .Select(p => p.ExternalRef!).ToListAsync();
            var existingRefs = new HashSet<string>(existing);

            int created = 0, skippedExisting = 0, skippedNoSupplier = 0, skippedNoTotal = 0;
            foreach (var h in headers)
            {
                var er = $"pbill:{h.Doc}";
                if (existingRefs.Contains(er)) { skippedExisting++; continue; }
                if (!supplierIdByTrader.TryGetValue(h.TraderId, out var supplierId)) { skippedNoSupplier++; continue; }

                // Total = the A/P credit to this supplier's ledger account on the
                // purchase voucher (folio), when resolvable; else Σ detail cost.
                decimal total = 0;
                if (folioCount.GetValueOrDefault(h.Folio) == 1
                    && traderAccount.TryGetValue(h.TraderId, out var acct)
                    && credits.TryGetValue(h.Folio, out var lines))
                {
                    total = lines.Where(l => l.Account == acct).Sum(l => l.Amount);
                }
                var dlines = detail.GetValueOrDefault(h.Doc) ?? new();
                if (total <= 0) total = dlines.Sum(d => Math.Round(d.Qty * d.Price, 2));
                if (total <= 0) { skippedNoTotal++; continue; }

                var bill = new PurchaseBill
                {
                    CompanyId = companyId,
                    SupplierId = supplierId,
                    PurchaseBillNumber = h.Doc,
                    Date = h.Date,
                    Subtotal = total,
                    GSTRate = 0,
                    GSTAmount = 0,
                    GrandTotal = total,
                    AmountInWords = "",
                    SupplierBillNumber = h.SupplierInv,
                    IsMigrated = true,
                    ExternalRef = er,
                    Items = dlines.Select(d => new PurchaseItem
                    {
                        Description = d.Desc,
                        Quantity = d.Qty,
                        UOM = "",
                        UnitPrice = d.Price,
                        LineTotal = Math.Round(d.Qty * d.Price, 2),
                    }).ToList(),
                };
                _db.PurchaseBills.Add(bill);
                created++;
            }
            await _db.SaveChangesAsync();

            result.Created["purchaseBills"] = created;
            result.Skipped["purchasesAlreadyImported"] = skippedExisting;
            if (skippedNoSupplier > 0) result.Notes.Add($"Skipped {skippedNoSupplier} purchase bills whose supplier wasn't imported as a Supplier.");
            if (skippedNoTotal > 0) result.Notes.Add($"Skipped {skippedNoTotal} purchase bills with no resolvable total.");
        }

        // ── Receipts / Payments ─────────────────────────────────────────────────

        public async Task<LegacyImportResult> ImportReceiptsPaymentsAsync(string sourceDb, int companyId)
        {
            UseSource(sourceDb);
            if (!await _db.Companies.AnyAsync(c => c.Id == companyId))
                throw new InvalidOperationException("Target company not found.");

            var traders = ReadTraders();
            var clientByRef = await _db.Clients.Where(c => c.CompanyId == companyId && c.ExternalRef != null)
                .ToDictionaryAsync(c => c.ExternalRef!, c => c.Id);
            var supplierByRef = await _db.Suppliers.Where(s => s.CompanyId == companyId && s.ExternalRef != null)
                .ToDictionaryAsync(s => s.ExternalRef!, s => s.Id);
            var clientIdByTrader = traders.Where(t => clientByRef.ContainsKey($"trader:{t.Id}"))
                .ToDictionary(t => t.Id, t => clientByRef[$"trader:{t.Id}"]);
            var supplierIdByTrader = traders.Where(t => supplierByRef.ContainsKey($"trader:{t.Id}"))
                .ToDictionary(t => t.Id, t => supplierByRef[$"trader:{t.Id}"]);
            var invoiceIdByDoc = await _db.Invoices.Where(i => i.CompanyId == companyId && i.ExternalRef != null)
                .ToDictionaryAsync(i => i.ExternalRef!, i => i.Id);
            var billIdByDoc = await _db.PurchaseBills.Where(p => p.CompanyId == companyId && p.ExternalRef != null)
                .ToDictionaryAsync(p => p.ExternalRef!, p => p.Id);

            var result = new LegacyImportResult();
            var touchedInvoices = new HashSet<int>();
            var touchedBills = new HashSet<int>();

            await ImportMoneyDocsAsync(companyId, PaymentDirection.Receipt,
                ReadReceiptHeaders(), ReadReceiptAllocs(),
                tid => clientIdByTrader.GetValueOrDefault(tid),
                doc => invoiceIdByDoc.GetValueOrDefault($"sinv:{doc}"),
                touchedInvoices, result);
            await ImportMoneyDocsAsync(companyId, PaymentDirection.Payment,
                ReadPaymentHeaders(), ReadPaymentAllocs(),
                tid => supplierIdByTrader.GetValueOrDefault(tid),
                doc => billIdByDoc.GetValueOrDefault($"pbill:{doc}"),
                touchedBills, result);

            await ReflowPaidTotalsAsync(companyId, result);
            return result;
        }

        // Generic for both directions: a money document settles target documents.
        // resolveTarget maps a legacy target doc-number to our Invoice/Bill id (0 = not imported).
        private async Task ImportMoneyDocsAsync(
            int companyId, PaymentDirection direction,
            List<MoneyHeaderRow> headers, Dictionary<int, List<(int Target, decimal Amount)>> allocsByDoc,
            Func<int, int> resolveContact, Func<int, int> resolveTarget,
            HashSet<int> touched, LegacyImportResult result)
        {
            var existingNums = await _db.Payments
                .Where(p => p.CompanyId == companyId && p.Direction == direction)
                .Select(p => p.Number).ToListAsync();
            var existing = new HashSet<int>(existingNums);
            var isReceipt = direction == PaymentDirection.Receipt;

            int created = 0, skippedExisting = 0, skippedNoAlloc = 0, skippedNoContact = 0;
            foreach (var h in headers)
            {
                if (existing.Contains(h.Doc)) { skippedExisting++; continue; }
                var lines = (allocsByDoc.GetValueOrDefault(h.Doc) ?? new())
                    .Select(l => (TargetId: resolveTarget(l.Target), l.Amount))
                    .Where(l => l.TargetId != 0 && l.Amount > 0)
                    .ToList();
                if (lines.Count == 0) { skippedNoAlloc++; continue; }
                var contactId = resolveContact(h.TraderId);
                if (contactId == 0) { skippedNoContact++; continue; }

                var payment = new Payment
                {
                    CompanyId = companyId,
                    Direction = direction,
                    Number = h.Doc,
                    Date = h.Date,
                    ContactType = isReceipt ? "Client" : "Supplier",
                    ContactId = contactId,
                    BankAccountName = h.Bank,
                    Method = string.IsNullOrWhiteSpace(h.ChequeNo) ? "Cash" : "Cheque",
                    ChequeNumber = h.ChequeNo,
                    ChequeDate = h.ChequeDate,
                    ChequeStatus = string.IsNullOrWhiteSpace(h.ChequeNo) ? ChequeStatus.None : ChequeStatus.Cleared,
                    IsCancelled = h.Void,
                    Amount = lines.Sum(l => l.Amount),
                    Allocations = lines.Select(l => new PaymentAllocation
                    {
                        InvoiceId = isReceipt ? l.TargetId : (int?)null,
                        PurchaseBillId = isReceipt ? (int?)null : l.TargetId,
                        Amount = l.Amount,
                    }).ToList(),
                };
                _db.Payments.Add(payment);
                foreach (var l in lines) touched.Add(l.TargetId);
                created++;
            }
            await _db.SaveChangesAsync();

            var label = isReceipt ? "receipts" : "payments";
            result.Created[label] = created;
            result.Skipped[$"{label}AlreadyImported"] = skippedExisting;
            if (skippedNoAlloc > 0) result.Notes.Add($"Skipped {skippedNoAlloc} {label} with no allocation to an imported document.");
            if (skippedNoContact > 0) result.Notes.Add($"Skipped {skippedNoContact} {label} whose party wasn't imported.");
        }

        // Reflow AmountPaid = Σ non-cancelled allocations, for every touched document.
        private async Task ReflowPaidTotalsAsync(int companyId, LegacyImportResult result)
        {
            var invSums = await _db.PaymentAllocations
                .Where(a => a.InvoiceId != null && a.Payment.CompanyId == companyId && !a.Payment.IsCancelled)
                .GroupBy(a => a.InvoiceId!.Value)
                .Select(g => new { Id = g.Key, Sum = g.Sum(x => x.Amount) }).ToListAsync();
            foreach (var s in invSums)
            {
                var inv = await _db.Invoices.FirstOrDefaultAsync(i => i.Id == s.Id);
                if (inv != null) inv.AmountPaid = s.Sum;
            }
            var billSums = await _db.PaymentAllocations
                .Where(a => a.PurchaseBillId != null && a.Payment.CompanyId == companyId && !a.Payment.IsCancelled)
                .GroupBy(a => a.PurchaseBillId!.Value)
                .Select(g => new { Id = g.Key, Sum = g.Sum(x => x.Amount) }).ToListAsync();
            foreach (var s in billSums)
            {
                var bill = await _db.PurchaseBills.FirstOrDefaultAsync(b => b.Id == s.Id);
                if (bill != null) bill.AmountPaid = s.Sum;
            }
            await _db.SaveChangesAsync();
            result.Created["invoicesReflowed"] = invSums.Count;
            result.Created["billsReflowed"] = billSums.Count;
        }

        // ── Legacy reads (read-only) ──────────────────────────────────────────────

        private record MoneyHeaderRow(int Doc, DateTime Date, int TraderId, string? Bank, string? ChequeNo, DateTime? ChequeDate, bool Void);

        private List<MoneyHeaderRow> ReadMoneyHeaders(string table)
        {
            var list = new List<MoneyHeaderRow>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT DocumentNumber, Date, ISNULL(FKTraderID,0), FKAccountCode_Bank, ChequeNumber, ChequeRealizationDate, ISNULL(FKFolioNumber_Void,0) FROM {table} WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
                list.Add(new MoneyHeaderRow(
                    rdr.GetInt32(0), rdr.GetDateTime(1), rdr.GetInt32(2),
                    rdr.IsDBNull(3) ? null : rdr.GetString(3).Trim(),
                    rdr.IsDBNull(4) ? null : rdr.GetString(4).Trim(),
                    rdr.IsDBNull(5) ? null : rdr.GetDateTime(5),
                    !rdr.IsDBNull(6) && rdr.GetInt32(6) > 0));
            return list;
        }
        private List<MoneyHeaderRow> ReadReceiptHeaders() => ReadMoneyHeaders("ReceiptMaster");
        private List<MoneyHeaderRow> ReadPaymentHeaders() => ReadMoneyHeaders("PaymentMaster");

        private Dictionary<int, List<(int Target, decimal Amount)>> ReadAllocs(string table, string targetCol)
        {
            var map = new Dictionary<int, List<(int, decimal)>>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT FKDocumentNumber, ISNULL({targetCol},0), ISNULL(Amount,0) FROM {table} WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
            {
                var parent = rdr.GetInt32(0);
                if (!map.TryGetValue(parent, out var lst)) { lst = new(); map[parent] = lst; }
                lst.Add((rdr.GetInt32(1), rdr.GetDecimal(2)));
            }
            return map;
        }
        private Dictionary<int, List<(int, decimal)>> ReadReceiptAllocs() => ReadAllocs("ReceiptDetail", "FKDocumentNumber_Sale");
        private Dictionary<int, List<(int, decimal)>> ReadPaymentAllocs() => ReadAllocs("PaymentDetail", "FKDocumentNumber_GRN");

        private record CoaRow(string Code, string? Parent, string Desc, string Type, bool IsControl, decimal OpeningDebit, decimal OpeningCredit);
        private record TraderRow(int Id, string? Name, int Type, string? Ntn, string? Gst, string? AccountCode);
        private record SaleHeaderRow(int Doc, int CompanyId, int Folio, DateTime Date, decimal Tax);
        private record PurchaseHeaderRow(int Doc, int Folio, int TraderId, DateTime Date, string? SupplierInv);
        private record VoucherLineRow(string Account, decimal Amount);
        private record DetailRow(string Desc, decimal Qty, decimal Price);

        private List<SaleHeaderRow> ReadSaleHeaders()
        {
            var list = new List<SaleHeaderRow>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT DocumentNumber, ISNULL(FKCompanyID,0), ISNULL(FKFolioNumber,0), DocumentDate, ISNULL(TaxAmount1,0) FROM SalesInvoiceMaster WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
                list.Add(new SaleHeaderRow(rdr.GetInt32(0), rdr.GetInt32(1), rdr.GetInt32(2), rdr.GetDateTime(3), rdr.GetDecimal(4)));
            return list;
        }

        private List<PurchaseHeaderRow> ReadPurchaseHeaders()
        {
            var list = new List<PurchaseHeaderRow>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT DocumentNumber, ISNULL(FKFolioNumber,0), ISNULL(FKTraderID,0), DocumentDate, SupplierInvoiceNumber FROM PurchaseMaster WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
                list.Add(new PurchaseHeaderRow(rdr.GetInt32(0), rdr.GetInt32(1), rdr.GetInt32(2), rdr.GetDateTime(3),
                    rdr.IsDBNull(4) ? null : rdr.GetString(4).Trim()));
            return list;
        }

        /// <summary>Voucher lines tied to a trader's ledger account, grouped by
        /// folio. debit=true returns the debit side (sale → customer A/R),
        /// debit=false the credit side (purchase → supplier A/P).</summary>
        private Dictionary<int, List<VoucherLineRow>> ReadVoucherTraderLines(bool debit)
        {
            var map = new Dictionary<int, List<VoucherLineRow>>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            var col = debit ? "Debit" : "Credit";
            cmd.CommandText =
                $"SELECT vd.FKFolio, vd.FKAccountCode, vd.{col} FROM VoucherDetail vd " +
                $"JOIN Trader t ON t.FKAccountCode = vd.FKAccountCode AND t.FKCostCentreID=1 WHERE vd.{col} > 0";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
            {
                var folio = rdr.GetInt32(0);
                if (!map.TryGetValue(folio, out var lst)) { lst = new(); map[folio] = lst; }
                lst.Add(new VoucherLineRow(rdr.IsDBNull(1) ? "" : rdr.GetString(1).Trim(), rdr.GetDecimal(2)));
            }
            return map;
        }

        private Dictionary<int, List<DetailRow>> ReadDocDetail(string table)
        {
            var map = new Dictionary<int, List<DetailRow>>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT FKDocumentNumber, Description, ISNULL(Quantity,0), ISNULL(UnitPrice,0) FROM {table} WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
            {
                var doc = rdr.GetInt32(0);
                if (!map.TryGetValue(doc, out var lst)) { lst = new(); map[doc] = lst; }
                lst.Add(new DetailRow(rdr.IsDBNull(1) ? "" : rdr.GetString(1).Trim(), rdr.GetDecimal(2), rdr.GetDecimal(3)));
            }
            return map;
        }

        private List<CoaRow> ReadCoa()
        {
            var list = new List<CoaRow>();
            using var conn = new SqlConnection(_connStr);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "SELECT AccountCode, ISNULL(ControlAccountCode,''), Description, AccountType, " +
                "IsControlAccount, OpeningDebit, OpeningCredit FROM ChartOfAccounts WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
            {
                var type = rdr.IsDBNull(3) ? "" : rdr.GetString(3).Trim();
                if (!TypeMap.ContainsKey(type)) continue;
                var parent = rdr.GetString(1).Trim();
                list.Add(new CoaRow(
                    rdr.GetString(0).Trim(),
                    parent.Length == 0 ? null : parent,
                    rdr.IsDBNull(2) ? "" : rdr.GetString(2).Trim(),
                    type,
                    !rdr.IsDBNull(4) && rdr.GetBoolean(4),
                    rdr.IsDBNull(5) ? 0 : rdr.GetDecimal(5),
                    rdr.IsDBNull(6) ? 0 : rdr.GetDecimal(6)));
            }
            return list;
        }

        private record CompanyProfileRow(int CompanyId, string? Name, string? ShortName, string? Address, string? Ntn, string? Gst);

        private List<CompanyProfileRow> ReadCompanyProfiles()
        {
            var list = new List<CompanyProfileRow>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT CompanyID, Name, ShortName, Address, NationalTaxNumber, GeneralSalesTaxNumber FROM CompanyProfile WHERE FKCostCentreID=1 ORDER BY CompanyID";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
                list.Add(new CompanyProfileRow(
                    rdr.GetInt32(0),
                    rdr.IsDBNull(1) ? null : rdr.GetString(1).Trim(),
                    rdr.IsDBNull(2) ? null : rdr.GetString(2).Trim(),
                    rdr.IsDBNull(3) ? null : rdr.GetString(3).Trim(),
                    rdr.IsDBNull(4) ? null : rdr.GetString(4).Trim(),
                    rdr.IsDBNull(5) ? null : rdr.GetString(5).Trim()));
            return list;
        }

        private record QuoteHeaderRow(int Doc, int CompanyId, int ContactId, DateTime Date, DateTime? Expiry);

        private List<QuoteHeaderRow> ReadQuoteHeaders()
        {
            var list = new List<QuoteHeaderRow>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT DocumentNumber, ISNULL(FKCompanyID,0), ISNULL(FKContactPersonID,0), DocumentDate, ExpiryDate FROM QuotationMaster WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
                list.Add(new QuoteHeaderRow(
                    rdr.GetInt32(0), rdr.GetInt32(1), rdr.GetInt32(2), rdr.GetDateTime(3),
                    rdr.IsDBNull(4) ? (DateTime?)null : rdr.GetDateTime(4)));
            return list;
        }

        private record SoHeaderRow(int Doc, int CompanyId, int ContactId, DateTime Date, DateTime? Expected);

        private List<SoHeaderRow> ReadSalesOrderHeaders()
        {
            var list = new List<SoHeaderRow>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT DocumentNumber, ISNULL(FKCompanyID,0), ISNULL(FKContactPersonID,0), DocumentDate, ExpectedDeliveryDate FROM SalesOrderMaster WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
                list.Add(new SoHeaderRow(
                    rdr.GetInt32(0), rdr.GetInt32(1), rdr.GetInt32(2), rdr.GetDateTime(3),
                    rdr.IsDBNull(4) ? (DateTime?)null : rdr.GetDateTime(4)));
            return list;
        }

        private record ChallanHeaderRow(int Doc, int CompanyId, int ContactId, DateTime Date, string? Po);

        private List<ChallanHeaderRow> ReadChallanHeaders()
        {
            var list = new List<ChallanHeaderRow>();
            using var conn = new SqlConnection(_connStr); conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT DocumentNumber, ISNULL(FKCompanyID,0), ISNULL(FKContactPersonID,0), DocumentDate, CustomerPONumber FROM DeliveryChallanMaster WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
                list.Add(new ChallanHeaderRow(
                    rdr.GetInt32(0), rdr.GetInt32(1), rdr.GetInt32(2), rdr.GetDateTime(3),
                    rdr.IsDBNull(4) ? null : rdr.GetString(4).Trim()));
            return list;
        }

        private List<TraderRow> ReadTraders()
        {
            var list = new List<TraderRow>();
            using var conn = new SqlConnection(_connStr);
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT TraderID, Company, FKTraderTypeID, NTN, GSTNumber, FKAccountCode FROM Trader WHERE FKCostCentreID=1";
            using var rdr = cmd.ExecuteReader();
            while (rdr.Read())
            {
                list.Add(new TraderRow(
                    rdr.GetInt32(0),
                    rdr.IsDBNull(1) ? null : rdr.GetString(1).Trim(),
                    rdr.IsDBNull(2) ? 0 : rdr.GetInt32(2),
                    rdr.IsDBNull(3) ? null : rdr.GetString(3).Trim(),
                    rdr.IsDBNull(4) ? null : rdr.GetString(4).Trim(),
                    rdr.IsDBNull(5) ? null : rdr.GetString(5).Trim()));
            }
            return list;
        }
    }
}
