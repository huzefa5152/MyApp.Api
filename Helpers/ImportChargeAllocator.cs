namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Spreads a GD's own charges (freight, clearing, wharfage, demurrage...) over
    /// its costed lines by ASSESSED VALUE (2026-10-05, maintainer's decision).
    /// PURE. Paisa-exact: every line gets its rounded share and the last line
    /// takes the remainder, so the shares always add up to the charges.
    /// Lines with no assessed value share by quantity instead, so a total is
    /// never left unallocated.
    /// </summary>
    public static class ImportChargeAllocator
    {
        public sealed record Line(int Id, decimal AssessedValue, decimal Quantity);

        public static Dictionary<int, decimal> Allocate(IReadOnlyList<Line> lines, decimal total)
        {
            var result = lines.ToDictionary(l => l.Id, _ => 0m);
            if (lines.Count == 0 || total == 0m) return result;
            var weights = lines.Sum(l => l.AssessedValue) > 0m
                ? lines.Select(l => Math.Max(0m, l.AssessedValue)).ToList()
                : lines.Select(l => Math.Max(0m, l.Quantity)).ToList();
            var sum = weights.Sum();
            if (sum <= 0m) { result[lines[^1].Id] = total; return result; }
            var given = 0m;
            for (int i = 0; i < lines.Count; i++)
            {
                var share = i == lines.Count - 1
                    ? total - given
                    : Math.Round(total * weights[i] / sum, 2, MidpointRounding.AwayFromZero);
                result[lines[i].Id] = share;
                given += share;
            }
            return result;
        }
    }
}
