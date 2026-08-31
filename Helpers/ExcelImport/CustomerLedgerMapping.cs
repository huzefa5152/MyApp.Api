using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Mapping for the <c>IndexPlusPerClientSheets</c> customer-ledger layout:
    /// one index sheet naming every customer, then one sheet per customer
    /// carrying that customer's transactions.
    ///
    /// Two things here look like over-engineering and are not.
    ///
    /// <see cref="LedgerColumns.RefAny"/> is a LIST because the document
    /// reference genuinely wanders between columns from sheet to sheet in the
    /// real workbooks — a single column number cannot express it, and reading
    /// the wrong column loses the invoice number silently.
    ///
    /// <see cref="LedgerColumns.Balance"/> is mapped but never used to compute
    /// anything. The running-balance column in these sheets is hand-maintained
    /// and routinely disagrees with its own rows; it is read ONLY so preview can
    /// report the disagreement.
    /// </summary>
    public class CustomerLedgerMapping
    {
        [JsonPropertyName("indexSheet")]
        public SheetSelector IndexSheet { get; set; } = new();

        [JsonPropertyName("indexFirstRow")]
        public int IndexFirstRow { get; set; } = 2;

        [JsonPropertyName("indexColumns")]
        public IndexCols IndexColumns { get; set; } = new();

        [JsonPropertyName("clientSheets")]
        public SheetSelector ClientSheets { get; set; } = new() { Mode = SheetSelector.AllExcept };

        /// <summary>Cell on each customer sheet holding that customer's name, in
        /// A1 notation. The sheet TAB name is often an abbreviation, so the cell
        /// is the more reliable source.</summary>
        [JsonPropertyName("clientNameCell")]
        public string ClientNameCell { get; set; } = "A1";

        [JsonPropertyName("firstDataRow")]
        public int FirstDataRow { get; set; } = 2;

        [JsonPropertyName("columns")]
        public LedgerColumns Columns { get; set; } = new();

        /// <summary>
        /// True when the Credit column holds invoices and Debit holds receipts —
        /// the convention these workbooks use, which is the reverse of standard
        /// A/R. False swaps them.
        /// </summary>
        [JsonPropertyName("creditIsInvoice")]
        public bool CreditIsInvoice { get; set; } = true;

        /// <summary>Shape a document reference must have to be treated as one.
        /// Anything else in the reference column is narrative ("Cash Rec").</summary>
        [JsonPropertyName("refPattern")]
        public string RefPattern { get; set; } = @"^[A-Za-z]{1,6}[-/ ]?\d+$";

        /// <summary>"carryPreviousRow" (use the last dated row on the sheet) or
        /// "periodEnd".</summary>
        [JsonPropertyName("undatedRule")]
        public string UndatedRule { get; set; } = CarryPreviousRow;

        public const string CarryPreviousRow = "carryPreviousRow";
        public const string UsePeriodEnd = "periodEnd";

        /// <summary>Date the opening documents carry — the day before the period
        /// starts, so an opening balance never lands inside the period it opens.</summary>
        [JsonPropertyName("openingDate")]
        public DateTime OpeningDate { get; set; }

        [JsonPropertyName("periodStart")]
        public DateTime PeriodStart { get; set; }

        [JsonPropertyName("periodEnd")]
        public DateTime PeriodEnd { get; set; }

        /// <summary>
        /// Document numbers for opening balances start here. Invoice numbers are
        /// integers unique per company, and the sheet's own references already
        /// occupy the low range, so openings need a band of their own.
        /// </summary>
        [JsonPropertyName("openingBand")]
        public int OpeningBand { get; set; } = 900000;

        /// <summary>Band for invoice rows that carry no usable reference. Must
        /// not overlap <see cref="OpeningBand"/>.</summary>
        [JsonPropertyName("unreferencedBand")]
        public int UnreferencedBand { get; set; } = 950000;

        public class IndexCols
        {
            [JsonPropertyName("name")] public int Name { get; set; }
            [JsonPropertyName("opening")] public int? Opening { get; set; }
            [JsonPropertyName("debit")] public int? Debit { get; set; }
            [JsonPropertyName("credit")] public int? Credit { get; set; }
            [JsonPropertyName("closing")] public int? Closing { get; set; }
        }

        public class LedgerColumns
        {
            [JsonPropertyName("date")] public int? Date { get; set; }

            /// <summary>Candidate reference columns, tried in order; the first
            /// non-empty one wins.</summary>
            [JsonPropertyName("refAny")] public List<int> RefAny { get; set; } = new();

            [JsonPropertyName("debit")] public int Debit { get; set; }
            [JsonPropertyName("credit")] public int Credit { get; set; }

            /// <summary>Read for COMPARISON only — never to compute a balance.</summary>
            [JsonPropertyName("balance")] public int? Balance { get; set; }
        }

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        private static readonly Regex CellRef = new(@"^\s*([A-Za-z]{1,3})(\d{1,7})\s*$", RegexOptions.Compiled);

        /// <summary>Resolves <see cref="ClientNameCell"/> to (row, col), 1-based.
        /// Returns (0,0) when it is not a cell reference.</summary>
        public (int Row, int Col) ResolveNameCell()
        {
            var m = CellRef.Match(ClientNameCell ?? "");
            if (!m.Success) return (0, 0);

            var letters = m.Groups[1].Value.ToUpperInvariant();
            var col = letters.Aggregate(0, (acc, ch) => acc * 26 + (ch - 'A' + 1));
            return (int.Parse(m.Groups[2].Value), col);
        }

        public static CustomerLedgerMapping Parse(string? mappingJson)
        {
            CustomerLedgerMapping? mapping;
            try
            {
                mapping = JsonSerializer.Deserialize<CustomerLedgerMapping>(
                    string.IsNullOrWhiteSpace(mappingJson) ? "{}" : mappingJson, JsonOptions);
            }
            catch (JsonException)
            {
                throw new InvalidOperationException("The column mapping for this layout is not valid JSON.");
            }

            mapping ??= new CustomerLedgerMapping();

            if (mapping.IndexColumns.Name <= 0)
                throw new InvalidOperationException("The mapping does not say which column of the index sheet holds the customer name.");
            if (mapping.Columns.Debit <= 0 || mapping.Columns.Credit <= 0)
                throw new InvalidOperationException("The mapping does not say which columns hold Debit and Credit.");
            if (mapping.FirstDataRow <= 0)
                throw new InvalidOperationException("The mapping does not say which row the transactions start on.");
            if (mapping.ResolveNameCell().Row == 0)
                throw new InvalidOperationException($"'{mapping.ClientNameCell}' is not a cell reference like A3.");
            if (mapping.PeriodEnd == default)
                throw new InvalidOperationException("The mapping does not say when the period ends.");
            if (mapping.OpeningDate == default)
                mapping.OpeningDate = mapping.PeriodStart != default
                    ? mapping.PeriodStart.AddDays(-1)
                    : mapping.PeriodEnd.AddYears(-1);

            // Overlapping bands would have an opening balance and an
            // unreferenced invoice fight over one document number, and the
            // loser's amount would silently vanish behind a unique-key retry.
            if (Math.Abs(mapping.OpeningBand - mapping.UnreferencedBand) < 10000)
                throw new InvalidOperationException(
                    "The opening and unreferenced document number bands are too close together — leave at least 10,000 between them.");

            return mapping;
        }

        public bool IsDocumentRef(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return false;
            try { return Regex.IsMatch(text.Trim(), RefPattern, RegexOptions.IgnoreCase); }
            catch (ArgumentException) { return false; }
        }

        /// <summary>Trailing digits of a reference — <c>AA-412</c> gives 412.
        /// Null when there are none, or they do not fit an int.</summary>
        public static int? NumberFromRef(string? reference)
        {
            if (string.IsNullOrWhiteSpace(reference)) return null;
            var digits = new string(reference.Reverse().TakeWhile(char.IsDigit).Reverse().ToArray());
            return int.TryParse(digits, out var n) && n > 0 ? n : null;
        }

        public static CustomerLedgerMapping Scaffold() => new()
        {
            IndexSheet = new SheetSelector { Mode = SheetSelector.ByIndex, Index = 0 },
            IndexFirstRow = 2,
            IndexColumns = new IndexCols { Name = 1, Opening = 2, Debit = 3, Credit = 4, Closing = 5 },
            ClientSheets = new SheetSelector { Mode = SheetSelector.AllExcept },
            ClientNameCell = "A1",
            FirstDataRow = 2,
            Columns = new LedgerColumns { Date = 1, RefAny = new List<int> { 2 }, Debit = 3, Credit = 4, Balance = 5 },
        };

        public string ToJson() => JsonSerializer.Serialize(this, JsonOptions);
    }
}
