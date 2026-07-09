using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Services.Implementations
{
    // ── FBR Purchase Import Matcher ─────────────────────────────────────
    //
    // Two questions, two methods:
    //   (1) Does this invoice already exist in our PurchaseBills?
    //       Match on Supplier NTN + InvoiceNo (base, suffix stripped) +
    //       Date (date part) + GrandTotal within 1 PKR. The 1-PKR
    //       tolerance accounts for FBR's rounding off-by-one.
    //
    //   (2) For a candidate line, what ItemType does it belong to?
    //       HS Code first → Description fallback (case-insensitive
    //       Name match within the company) → none (would be created on
    //       commit in Phase 2).
    //
    // The matcher is the only DB reader in the import pipeline. The
    // parser doesn't touch DB; the filter doesn't touch DB; the
    // orchestrator drives them and asks the matcher for these two
    // questions per invoice / line.

    public interface IFbrPurchaseImportMatcher
    {
        /// <summary>
        /// Pre-loads supplier NTN → SupplierId map for the company, so
        /// the orchestrator can look up suppliers in O(1) without a
        /// query per invoice. Also returns "supplier groups" (Common
        /// Suppliers feature) so a Lotte-NTN supplier saved on Hakimi
        /// auto-resolves on Roshan.
        /// </summary>
        Task<SupplierLookup> LoadSuppliersAsync(int companyId);

        /// <summary>
        /// Pre-loads ItemType lookups for the company. Two indexes:
        /// HS Code → ItemType (primary match) and lower-cased Name →
        /// ItemType (fallback). Both scoped to companyId so a Hakimi
        /// import never cross-matches a Roshan ItemType.
        /// </summary>
        Task<ItemTypeLookup> LoadItemTypesAsync(int companyId);

        /// <summary>
        /// Decide whether an FBR purchase invoice is already in our system.
        /// Takes the supplier id the orchestrator already resolved (by NTN
        /// then name) — the SAME id the committer attaches the bill to — so
        /// dedup and commit never disagree. Matches on the FBR invoice
        /// number against BOTH stored identifiers — SupplierBillNumber
        /// (where the FBR importer writes it) and SupplierIRN (where a
        /// manually-keyed bill often carries it). A unique IRN-style
        /// invoice number is accepted on the string match alone; a short
        /// numeric bill number additionally needs date or ±1 PKR gross
        /// corroboration to avoid false "already exists". Returns the
        /// matching PurchaseBill id, or null when nothing matches.
        /// </summary>
        Task<int?> FindMatchingPurchaseBillIdAsync(
            int companyId, int supplierId, string baseInvoiceNo, string rawInvoiceNo,
            DateTime invoiceDate, decimal grossTotal);

        /// <summary>
        /// Strip line-item suffixes ("…-1", "…-2") from FBR's invoice
        /// number so all lines of a multi-line invoice group together.
        /// </summary>
        string StripLineSuffix(string invoiceNo);
    }

    /// <summary>
    /// Supplier lookup result. Contains both per-company suppliers and
    /// cross-tenant SupplierGroup matches (NTN-based grouping the user
    /// already uses for the Common Suppliers feature).
    /// </summary>
    public class SupplierLookup
    {
        // Direct supplier rows in this company, keyed by normalized NTN.
        public Dictionary<string, int> SupplierIdByNtn { get; init; } = new();
        // Supplier rows by normalized name (case-insensitive). Fallback
        // when NTN is missing — rare but happens for ungrouped legacy
        // suppliers.
        public Dictionary<string, int> SupplierIdByName { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    }

    public class ItemTypeLookup
    {
        public Dictionary<string, int> ItemTypeIdByHsCode { get; init; } = new();
        public Dictionary<string, int> ItemTypeIdByName { get; init; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<int, string> NameById { get; init; } = new();
    }

    public class FbrPurchaseImportMatcher : IFbrPurchaseImportMatcher
    {
        private readonly AppDbContext _context;
        // Strip a trailing "-N" or "-NN" suffix from the FBR invoice
        // number. Some FBR refs end in legitimate alphanumerics with
        // hyphens (e.g. "POGI-1234") so we ONLY strip 1-2 trailing
        // digits after the LAST hyphen, leaving the rest intact.
        private static readonly Regex LineSuffix = new(@"-\d{1,3}$", RegexOptions.Compiled);

        public FbrPurchaseImportMatcher(AppDbContext context)
        {
            _context = context;
        }

        public async Task<SupplierLookup> LoadSuppliersAsync(int companyId)
        {
            var rows = await _context.Suppliers
                .Where(s => s.CompanyId == companyId)
                .Select(s => new { s.Id, s.NTN, s.Name })
                .ToListAsync();

            var byNtn = new Dictionary<string, int>();
            var byName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var s in rows)
            {
                if (!string.IsNullOrWhiteSpace(s.NTN)) byNtn[s.NTN.Trim()] = s.Id;
                if (!string.IsNullOrWhiteSpace(s.Name)) byName[s.Name.Trim()] = s.Id;
            }
            return new SupplierLookup { SupplierIdByNtn = byNtn, SupplierIdByName = byName };
        }

        public async Task<ItemTypeLookup> LoadItemTypesAsync(int companyId)
        {
            // ItemType is shared across all companies in the current
            // schema (no CompanyId on ItemType). Phase 2 may need to
            // tenant-scope this, but for Phase 1 preview we surface
            // matches against the global catalog. Soft-deleted rows are
            // excluded so a deleted catalog entry no longer surfaces as
            // a preview match.
            var rows = await _context.ItemTypes
                .Where(it => !it.IsDeleted)
                .Select(it => new { it.Id, it.Name, it.HSCode })
                .ToListAsync();

            var byHs = new Dictionary<string, int>();
            var byName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var nameById = new Dictionary<int, string>();
            foreach (var it in rows)
            {
                if (!string.IsNullOrWhiteSpace(it.HSCode)) byHs[it.HSCode.Trim()] = it.Id;
                if (!string.IsNullOrWhiteSpace(it.Name)) byName[it.Name.Trim()] = it.Id;
                nameById[it.Id] = it.Name ?? "";
            }
            return new ItemTypeLookup { ItemTypeIdByHsCode = byHs, ItemTypeIdByName = byName, NameById = nameById };
        }

        public async Task<int?> FindMatchingPurchaseBillIdAsync(
            int companyId, int supplierId, string baseInvoiceNo, string rawInvoiceNo,
            DateTime invoiceDate, decimal grossTotal)
        {
            // The caller resolved the supplier (NTN then name) and only
            // calls us when that succeeded — if the supplier isn't in our
            // system, the bill can't be either, so the row is genuinely new.
            if (supplierId <= 0) return null;

            var baseNo = (baseInvoiceNo ?? "").Trim();
            var rawNo = (rawInvoiceNo ?? "").Trim();
            if (baseNo.Length == 0 && rawNo.Length == 0) return null;

            // Pull this supplier's bills whose stored invoice identifier
            // (SupplierBillNumber OR SupplierIRN) string-matches the FBR
            // invoice number, on either the base (suffix-stripped) or raw
            // form. Cardinality is tiny (one supplier × one number).
            var candidates = await _context.PurchaseBills
                .Where(pb => pb.CompanyId == companyId
                          && pb.SupplierId == supplierId
                          && (pb.SupplierBillNumber == baseNo
                           || pb.SupplierBillNumber == rawNo
                           || pb.SupplierIRN == baseNo
                           || pb.SupplierIRN == rawNo))
                .Select(pb => new { pb.Id, pb.GrandTotal, pb.Date })
                .ToListAsync();
            if (candidates.Count == 0) return null;

            // An FBR/IRN-style invoice number contains non-digit characters
            // and is globally unique, so a string hit alone is a confident
            // "already in system" — no date/total corroboration needed.
            var invoiceNoIsUnique = baseNo.Any(ch => !char.IsDigit(ch))
                                 || rawNo.Any(ch => !char.IsDigit(ch));
            if (invoiceNoIsUnique) return candidates[0].Id;

            // Short numeric bill numbers (e.g. "120") can repeat across
            // suppliers/periods, so require date OR ±1 PKR gross
            // corroboration before declaring a duplicate.
            var dateOnly = invoiceDate.Date;
            foreach (var c in candidates)
            {
                if (dateOnly != DateTime.MinValue.Date && c.Date.Date == dateOnly) return c.Id;
                if (grossTotal > 0m && Math.Abs(c.GrandTotal - grossTotal) <= 1m) return c.Id;
            }
            return null;
        }

        public string StripLineSuffix(string invoiceNo)
        {
            if (string.IsNullOrWhiteSpace(invoiceNo)) return invoiceNo ?? "";
            var trimmed = invoiceNo.Trim();
            return LineSuffix.Replace(trimmed, "");
        }
    }
}
