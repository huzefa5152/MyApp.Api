using System.Globalization;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The sales tax rate an importer's goods came IN at, and whether a bill is
    /// about to charge a different one.
    ///
    /// An importer pays sales tax at the port, and customs states the rate on the
    /// goods declaration: 18% for ordinary goods, 25% for goods listed in SRO
    /// 297(I)/2023, which are also 25% on every later supply. The bill forms open
    /// on the standard-rate scenario, so 25% goods were being billed — and filed —
    /// at 18% with nothing on screen to say otherwise.
    ///
    /// The evidence is the COMPANY'S OWN record of the ITEM: its GD lines, its
    /// opening stock, its stock received at a stated rate. Two things are
    /// deliberately NOT evidence:
    ///
    ///   - another item that shares the HS code. Distinct products share a code
    ///     (a juicer and chopper parts both sit under 8509.9000; a chopper and its
    ///     parts sit either side of 8509.8000 / 8509.9000), and a code match is how
    ///     they got tangled in the first place.
    ///   - another company's GD. It is a different business's goods, and quoting it
    ///     would hand one tenant another tenant's declarations.
    ///
    /// Only UNAMBIGUOUS evidence is enforced — every record agrees and no GD line
    /// under the item carries a different HS code — and only on the question it
    /// can settle: standard rate or SRO 297 (see <c>FullRates</c>). Contradictory
    /// evidence, and a bill under a special regime (exempt, zero-rated, reduced),
    /// is reported for review and never blocks: refusing a sale on the strength
    /// of a record that disagrees with itself would stop a business billing
    /// because of a typing error in an opening sheet.
    ///
    /// This is the ONE place the rule and its wording live. The bill forms, the
    /// server's create / update guard and the bill list all read it, so what
    /// warns is what blocks.
    /// </summary>
    public static class ImportedTaxRate
    {
        // No zero value: a default(Evidence) must never read as a GD.
        public enum EvidenceKind { Gd = 1, Opening = 2, Received = 3 }

        /// <summary>One record of the rate this company's goods came in at.</summary>
        public readonly record struct Evidence(
            EvidenceKind Kind,
            decimal Rate,
            string? HsCode = null,
            string? GdNumber = null,
            DateTime? GdDate = null);

        /// <summary>What the company's own records say about one item.</summary>
        public sealed record Verdict(
            int ItemTypeId,
            decimal? Rate,
            IReadOnlyList<decimal> Rates,
            string? Source,
            string? HsConflict)
        {
            /// <summary>The item's records carry more than one rate.</summary>
            public bool Mixed => Rates.Count > 1;

            /// <summary>Enforceable: one rate, and the codes line up.</summary>
            public bool IsUnambiguous => Rate != null && !Mixed && HsConflict == null;
        }

        /// <summary>What a bill line should be told about its rate.</summary>
        public sealed record Finding(bool Enforce, string Message);

        /// <summary>
        /// Weigh the company's records for one item. The records are the whole
        /// answer: the stock walk's rate is always one of them (it starts at the
        /// opening rate and moves only to a rate a receipt stated), so consulting
        /// it would only pick among the rates of an item whose records are mixed
        /// — and a mixed verdict is advisory whatever it names.
        /// </summary>
        public static Verdict Resolve(int itemTypeId, string? itemHsCode, IEnumerable<Evidence> evidence)
        {
            var itemHs = NormaliseHs(itemHsCode);
            var counted = new List<Evidence>();
            string? hsConflict = null;

            foreach (var e in evidence ?? Enumerable.Empty<Evidence>())
            {
                if (e.Rate <= 0m) continue;

                // A GD line filed under ANOTHER code describes other goods, or the
                // item is misclassified — either way its rate is not this item's.
                // It is set aside, and its presence makes the verdict reviewable
                // rather than enforceable.
                if (e.Kind == EvidenceKind.Gd && itemHs != null)
                {
                    var gdHs = NormaliseHs(e.HsCode);
                    if (gdHs != null && gdHs != itemHs)
                    {
                        hsConflict ??= $"GD {e.GdNumber} lists HS {gdHs} under this item, which is classified {itemHs}";
                        continue;
                    }
                }
                counted.Add(e);
            }

            var rates = counted.Select(e => e.Rate).Distinct().OrderBy(r => r).ToList();

            decimal? rate = rates.Count == 1 ? rates[0] : null;

            return new Verdict(itemTypeId, rate, rates, SourceFor(counted, rate), hsConflict);
        }

        /// <summary>
        /// The two FULL rates — the standard rate and the SRO 297(I)/2023 rate —
        /// are the only ones the rate the goods came in at can settle. Which of
        /// the two a sale carries is decided by the GOODS, and customs has already
        /// decided it on the GD. Every other rate is a regime the operator chose
        /// for the TRANSACTION — exempt or zero-rated (0%), a reduced rate, the
        /// fixed-rate schedules — and the import rate cannot contradict that: goods
        /// that came in at 18% are zero-rated when exported. An old 17% opening
        /// from before the standard rate moved is likewise not a reason to refuse
        /// 18% today.
        /// </summary>
        private static readonly HashSet<decimal> FullRates = new() { 18m, 25m };

        /// <summary>
        /// Compare an item's verdict with the rate a bill charges. Null when there
        /// is nothing to say — no record, or the rates agree.
        ///
        /// Enforced only when BOTH rates are full rates and they differ — the
        /// standard-vs-SRO-297 mistake this rule exists for. Anything else that
        /// disagrees is reported for review.
        /// </summary>
        public static Finding? Check(Verdict? verdict, string itemName, decimal billRate)
        {
            if (verdict == null) return null;
            var name = string.IsNullOrWhiteSpace(itemName) ? "This item" : itemName.Trim();

            if (verdict.Mixed)
            {
                // Mixed records cannot say which rate THIS sale is — that needs the
                // stock tied to the GD lot it came from — so they are reported
                // whatever the bill charges and never refuse: only the operator
                // knows which stock is going out.
                return new Finding(false,
                    $"{name} came in at {Join(verdict.Rates)} — check which stock this sale is from " +
                    "before relying on the rate.");
            }

            if (verdict.Rate is not { } rate || rate == billRate) return null;

            if (verdict.HsConflict != null)
                return new Finding(false,
                    $"{name}: stock records say {Pct(rate)}, but {verdict.HsConflict} — check the item " +
                    $"before relying on either rate. This bill charges {Pct(billRate)}.");

            if (!FullRates.Contains(rate) || !FullRates.Contains(billRate))
                return new Finding(false,
                    $"{name} was imported at {Pct(rate)} ({verdict.Source}); this bill charges " +
                    $"{Pct(billRate)}. Check the scenario is the one this sale needs.");

            var suffix = rate == 25m
                ? " Goods listed in SRO 297(I)/2023 are billed under SN024 at 25%."
                : "";
            return new Finding(true,
                $"{name} was imported at {Pct(rate)} ({verdict.Source}), but this bill charges " +
                $"{Pct(billRate)}.{suffix}");
        }

        private static string? SourceFor(List<Evidence> counted, decimal? rate)
        {
            if (rate == null) return null;
            var atRate = counted.Where(e => e.Rate == rate).ToList();

            // The most recent GD at this rate is the most specific thing to cite.
            var gd = atRate.Where(e => e.Kind == EvidenceKind.Gd && !string.IsNullOrWhiteSpace(e.GdNumber))
                           .OrderByDescending(e => e.GdDate ?? DateTime.MinValue)
                           .Select(e => (Evidence?)e)
                           .FirstOrDefault();
            if (gd is { } g)
                return g.GdDate is { } d
                    ? $"GD {g.GdNumber!.Trim()} of {d.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture)}"
                    : $"GD {g.GdNumber!.Trim()}";

            if (atRate.Any(e => e.Kind == EvidenceKind.Opening)) return "opening stock";
            return "stock received";
        }

        /// <summary>Codes compare on digits and dots only — "8509.8000 " is 8509.8000.</summary>
        public static string? NormaliseHs(string? hs)
        {
            if (string.IsNullOrWhiteSpace(hs)) return null;
            var t = new string(hs.Where(c => char.IsDigit(c) || c == '.').ToArray());
            return t.Length == 0 ? null : t;
        }

        private static string Pct(decimal r) => r.ToString("0.##", CultureInfo.InvariantCulture) + "%";

        private static string Join(IReadOnlyList<decimal> rates) =>
            rates.Count switch
            {
                0 => "",
                1 => Pct(rates[0]),
                _ => string.Join(", ", rates.Take(rates.Count - 1).Select(Pct)) + " and " + Pct(rates[^1]),
            };
    }
}
