using System.Globalization;
using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers.Onboarding
{
    /// <summary>A problem with one cell. Errors stop the row; warnings do not.</summary>
    public record RowIssue(string? Column, string Message, bool IsError);

    /// <summary>
    /// The lookup values a row is checked against: the installation's FBR
    /// province list (label -> code) and registration types.
    /// </summary>
    public record RuleContext(
        IReadOnlyDictionary<string, int> ProvinceCodeByLabel,
        IReadOnlyCollection<string> RegistrationTypes);

    /// <summary>
    /// Pure checks for one parsed onboarding row: no database, no service.
    /// Whether a row already exists, or names an item that exists, is the
    /// import service's question — this only says whether the row's own cells
    /// make sense. Every message names its column, because the operator reads
    /// it next to a row number and has to find the cell.
    /// </summary>
    public static class OnboardingRowRules
    {
        private static readonly Regex HsFormat = new(@"^\d{4}\.\d{4}$", RegexOptions.Compiled);

        public static string DigitsOnly(string? raw) =>
            new string((raw ?? "").Where(char.IsDigit).ToArray());

        /// <summary>
        /// A 7-digit NTN. IRIS issues it with a check digit (1234567-8); FBR
        /// files the seven. A 13-digit value is a CNIC in the wrong column and
        /// returns null so the caller can say so.
        /// </summary>
        public static string? NormaliseNtn(string? raw)
        {
            var d = DigitsOnly(raw);
            if (d.Length == 7) return d;
            if (d.Length == 8) return d[..7];
            return null;
        }

        /// <summary>
        /// 8481.8090 in the tariff's own shape. Accepts 84818090, and a code
        /// Excel stored as a number and so lost its trailing zero (8481.809).
        /// Anything else is returned trimmed for the format check to refuse.
        /// </summary>
        public static string NormaliseHsCode(string? raw)
        {
            var s = (raw ?? "").Trim();
            if (s.Length == 0) return "";
            var digitsOnly = DigitsOnly(s);
            if (Regex.IsMatch(s, @"^\d{8}$")) return $"{s[..4]}.{s[4..]}";
            var m = Regex.Match(s, @"^(\d{4})\.(\d{1,4})$");
            if (m.Success) return $"{m.Groups[1].Value}.{m.Groups[2].Value.PadRight(4, '0')}";
            return digitsOnly.Length == 8 && s.All(ch => char.IsDigit(ch) || ch == '.' || ch == '-' || ch == ' ')
                ? $"{digitsOnly[..4]}.{digitsOnly[4..]}"
                : s;
        }

        /// <summary>The list's own spelling of a registration type, or null.</summary>
        public static string? ResolveRegistrationType(string? raw, IReadOnlyCollection<string> types) =>
            types.FirstOrDefault(t => string.Equals(t, (raw ?? "").Trim(), StringComparison.OrdinalIgnoreCase));

        public static int? ResolveProvince(string? raw, IReadOnlyDictionary<string, int> byLabel)
        {
            var s = (raw ?? "").Trim();
            if (s.Length == 0) return null;
            foreach (var kv in byLabel)
                if (string.Equals(kv.Key, s, StringComparison.OrdinalIgnoreCase)) return kv.Value;
            return null;
        }

        public static string? ResolveSaleType(string? raw)
        {
            var s = (raw ?? "").Trim();
            if (s.Length == 0) return OnboardingSchema.DefaultSaleType;
            return OnboardingSchema.SaleTypes.FirstOrDefault(t => string.Equals(t, s, StringComparison.OrdinalIgnoreCase));
        }

        public static decimal? ParseQuantity(string? raw) =>
            decimal.TryParse((raw ?? "").Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var q) ? q : null;

        public static DateTime? ParseDate(string? raw)
        {
            var s = (raw ?? "").Trim();
            if (s.Length == 0) return null;
            string[] formats = { "yyyy-MM-dd", "dd-MM-yyyy", "dd/MM/yyyy", "d-M-yyyy", "d/M/yyyy", "dd-MMM-yyyy", "d-MMM-yyyy", "dd MMM yyyy" };
            return DateTime.TryParseExact(s, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d.Date : null;
        }

        public static bool NeedsNtn(string? registrationType) =>
            string.Equals(registrationType, "Registered", StringComparison.OrdinalIgnoreCase)
            || string.Equals(registrationType, "FTN", StringComparison.OrdinalIgnoreCase);

        public static List<RowIssue> Check(string sheetKey, ParsedRow row, RuleContext ctx)
        {
            var sheet = OnboardingSchema.Find(sheetKey)
                ?? throw new ArgumentException($"Unknown onboarding sheet '{sheetKey}'.", nameof(sheetKey));
            var issues = new List<RowIssue>();
            string H(string key) => sheet.Columns.First(c => c.Key == key).Heading;
            void Error(string key, string msg) => issues.Add(new RowIssue(H(key), msg, true));
            void Warn(string key, string msg) => issues.Add(new RowIssue(H(key), msg, false));

            foreach (var col in sheet.Columns.Where(c => c.Requirement == Requirement.Required))
                if (string.IsNullOrWhiteSpace(row.Get(col.Key)))
                    Error(col.Key, "required");

            switch (sheet.Key)
            {
                case OnboardingSheets.Customers:
                case OnboardingSheets.Suppliers:
                    CheckParty(sheet.Key == OnboardingSheets.Customers, row, ctx, Error, Warn);
                    break;
                case OnboardingSheets.Items:
                    CheckItem(row, Error, Warn);
                    break;
                case OnboardingSheets.OpeningStock:
                    CheckOpeningStock(row, Error);
                    break;
            }
            return issues;
        }

        private static void CheckParty(bool isCustomer, ParsedRow row, RuleContext ctx,
            Action<string, string> error, Action<string, string> warn)
        {
            var who = isCustomer ? "customer" : "supplier";
            var typeRaw = row.Get("registrationType");
            var type = ResolveRegistrationType(typeRaw, ctx.RegistrationTypes);
            if (typeRaw.Length > 0 && type == null)
                error("registrationType", $"\"{typeRaw}\" is not one of {string.Join(", ", ctx.RegistrationTypes)}");

            var ntnRaw = row.Get("ntn");
            if (ntnRaw.Length > 0 && NormaliseNtn(ntnRaw) == null)
                error("ntn", DigitsOnly(ntnRaw).Length == 13
                    ? "13 digits is a CNIC, put it in the CNIC column"
                    : "must be 7 digits, e.g. 1234567");
            else if (ntnRaw.Length == 0 && NeedsNtn(type))
                error("ntn", $"required for a {type} {who}");

            var cnicRaw = row.Get("cnic");
            if (cnicRaw.Length > 0 && DigitsOnly(cnicRaw).Length != 13)
                error("cnic", "must be 13 digits, e.g. 42101-1234567-1");
            else if (cnicRaw.Length == 0 && string.Equals(type, "CNIC", StringComparison.OrdinalIgnoreCase))
                error("cnic", $"required for a CNIC {who}");

            var provinceRaw = row.Get("province");
            if (provinceRaw.Length > 0 && ResolveProvince(provinceRaw, ctx.ProvinceCodeByLabel) == null)
                error("province", $"\"{provinceRaw}\" is not one of {string.Join(", ", ctx.ProvinceCodeByLabel.Keys)}");

            if (row.Get("strn").Length > 0 && type != null
                && !string.Equals(type, "Registered", StringComparison.OrdinalIgnoreCase))
                warn("strn", "only kept for a Registered " + who + ", so it will not be stored");

            if (isCustomer && row.Get("address").Length == 0)
                warn("address", "empty. Bills print it and FBR receives it");
        }

        private static void CheckItem(ParsedRow row, Action<string, string> error, Action<string, string> warn)
        {
            var hs = NormaliseHsCode(row.Get("hsCode"));
            if (hs.Length == 0)
                warn("hsCode", "empty. This item cannot be filed with FBR until it has an HS code");
            else if (!HsFormat.IsMatch(hs))
                error("hsCode", $"\"{row.Get("hsCode")}\" must look like 8481.8090");

            var saleRaw = row.Get("saleType");
            if (saleRaw.Length > 0 && ResolveSaleType(saleRaw) == null)
                error("saleType", $"\"{saleRaw}\" is not a sale type in the list");
        }

        private static void CheckOpeningStock(ParsedRow row, Action<string, string> error)
        {
            var hs = NormaliseHsCode(row.Get("hsCode"));
            if (hs.Length > 0 && !HsFormat.IsMatch(hs))
                error("hsCode", $"\"{row.Get("hsCode")}\" must look like 8481.8090");

            var qRaw = row.Get("quantity");
            if (qRaw.Length > 0)
            {
                var q = ParseQuantity(qRaw);
                if (q == null) error("quantity", $"\"{qRaw}\" is not a number");
                else if (q <= 0) error("quantity", "must be more than 0");
            }

            var dRaw = row.Get("asOfDate");
            if (dRaw.Length > 0 && ParseDate(dRaw) == null)
                error("asOfDate", $"\"{dRaw}\" is not a date, use e.g. 01-07-2026");
        }
    }
}
