using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
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
        private readonly string? _connStr;

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
            _connStr = config.GetConnectionString("LegacyDb");
        }

        public bool IsConfigured => !string.IsNullOrWhiteSpace(_connStr);

        public async Task<LegacyImportResult> ImportMastersAsync(int companyId)
        {
            if (!IsConfigured)
                throw new InvalidOperationException("Legacy import is not configured (ConnectionStrings:LegacyDb missing).");
            if (!await _db.Companies.AnyAsync(c => c.Id == companyId))
                throw new InvalidOperationException("Target company not found.");

            var result = new LegacyImportResult();
            var coa = ReadCoa();
            await ImportCoaAsync(companyId, coa, result);
            await ImportPartiesAsync(companyId, coa, result);
            return result;
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

        // ── Legacy reads (read-only) ──────────────────────────────────────────────

        private record CoaRow(string Code, string? Parent, string Desc, string Type, bool IsControl, decimal OpeningDebit, decimal OpeningCredit);
        private record TraderRow(int Id, string? Name, int Type, string? Ntn, string? Gst, string? AccountCode);

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
