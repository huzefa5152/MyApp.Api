namespace MyApp.Api.Services.Tax
{
    /// <summary>
    /// HS-code prefix → FBR scenario heuristics. Lets the Item Type form
    /// suggest a non-standard rate / sale type when the operator types an
    /// HS code that falls into a well-known scenario (petroleum, electric
    /// vehicles, mobile phones, etc.) — instead of always defaulting to
    /// 18 % Standard.
    ///
    /// FBR has no official HS-code → scenario mapping API, so this table
    /// is hand-curated from V1.12 §9 + the SRO / Schedule references the
    /// scenarios cite. Entries are conservative — only HS prefixes whose
    /// scenario assignment is clear from the spec are included. When in
    /// doubt the heuristic returns null and the caller falls back to the
    /// standard 18 % default (which is correct for the long tail of
    /// industrial / B2B goods).
    ///
    /// To add a new prefix: drop one line into the table below. Match is
    /// "starts-with" against the HS code with non-digit chars stripped, so
    /// "2710.1290", "27101290", "2710.12.90" all match the same prefix.
    /// </summary>
    public static class HsPrefixHeuristics
    {
        // Each entry: (HS prefix as digits-only, FBR scenario code).
        // Order matters — the FIRST match wins, so list more specific
        // prefixes (e.g. "851713") BEFORE broader ones (e.g. "8517").
        private static readonly (string Prefix, string ScenarioCode)[] Rules = new[]
        {
            // ── Petroleum (HS chapter 27.10 — Mineral fuels) ─────────
            ("2710", "SN012"),    // Light oils, motor spirit, diesel, fuel oils, residues

            // ── Natural gas (HS 2711.x — Gas to CNG / pipeline) ──────
            ("2711", "SN014"),

            // ── CNG sale (HS 2711.21 specifically — natural gas in
            //    gaseous state); SN014 is the canonical Gas-to-CNG-stations
            //    line, SN023 (CNG Sales) is the retailer-level scenario.
            //    SN014 wins by ordering above for upstream sellers.

            // ── Mobile phones (9th Schedule) — HS 8517.13xx, 8517.14xx ─
            ("851713", "SN015"),
            ("851714", "SN015"),

            // ── Electric vehicles (HS 8703.80xx — electric motor cars) ─
            ("870380", "SN020"),

            // ── Cotton (raw — HS 5201.xx, ginners' purchase scenario) ──
            ("5201",   "SN009"),

            // ── Telecom services classification (HS 9985.x in PRAL's
            //    services register) — SN010 at 19.5 %.
            ("9985",   "SN010"),

            // ── Cement (HS 2523.xx) — SN021 Cement / Concrete Block ─
            ("2523",   "SN021"),

            // ── Steel sector — SN003 Steel Melting & re-rolling.
            //    Coverage: ingots/billets (7206-7207), flat-rolled
            //    sheets/coils/strip (7208-7212), and bars/rods
            //    (7213-7215). Deliberately EXCLUDES 7304-7307 (steel
            //    tubes, pipes, fittings) so industrial B2B distributors
            //    selling those still get SN001 18 % standard rate —
            //    the steel-sector scenarios are for upstream manufacture
            //    and primary processing, not pipe/fitting wholesale.
            ("7206",   "SN003"),    // Iron / non-alloy steel — ingots / primary forms
            ("7207",   "SN003"),    // Semi-finished — billets, slabs
            ("7208",   "SN003"),    // Flat-rolled — hot-rolled sheets
            ("7209",   "SN003"),    // Flat-rolled — cold-rolled sheets
            ("7210",   "SN003"),    // Flat-rolled — clad / plated / coated
            ("7211",   "SN003"),    // Flat-rolled — narrow strip
            ("7212",   "SN003"),    // Flat-rolled — clad / plated, narrow
            ("7213",   "SN003"),    // Bars and rods, hot-rolled
            ("7214",   "SN003"),    // Bars and rods, forged / cold-finished
            ("7215",   "SN003"),    // Other bars and rods

            // ── Ship breaking (SN004) is intentionally NOT auto-detected.
            //    The HS code 8908 covers "vessels and other floating
            //    structures for breaking up" — i.e. the SHIP being sold
            //    TO a breaker. The taxable supply under SN004 is the
            //    scrap that COMES FROM the breaker (steel/copper/etc.),
            //    which falls under regular scrap codes (7204, 7404)
            //    that overlap normal metal-scrap commerce. There's no
            //    clean HS prefix that reliably picks SN004, so we leave
            //    operators to set Sale Type manually for ship breakers.

            // ── 3rd Schedule retail FMCG goods — tax backed OUT of
            //    MRP (SN008). These are common consumer items where
            //    the manufacturer/importer pays tax on the printed
            //    retail price, not the wholesale invoice price.
            ("3401",   "SN008"),    // Soap
            ("3402",   "SN008"),    // Detergents
            ("853922", "SN008"),    // Incandescent light bulbs
            ("170199", "SN008"),    // Refined sugar
            ("210690", "SN008"),    // Food preparations (specified)
            ("8506",   "SN008"),    // Batteries — primary cells / dry cells (3rd Schedule)

            // ── Pharmaceuticals at fixed ST rate (DRAP / 8th Schedule
            //    Table 1 serial 81) — SN025 at 1 %. HS 3003-3004 covers
            //    medicaments for human / veterinary use.
            ("3003",   "SN025"),
            ("3004",   "SN025"),
        };

        /// <summary>
        /// Returns the matching scenario for an HS code, or null if no
        /// heuristic applies (callers should default to SN001 standard
        /// rate). Match is case-insensitive and tolerant of separators —
        /// "2710.1290", "27101290", "2710-1290" all match the "2710" rule.
        /// </summary>
        public static TaxScenarios.Scenario? Match(string? hsCode)
        {
            if (string.IsNullOrWhiteSpace(hsCode)) return null;
            var digits = new string(hsCode.Where(char.IsDigit).ToArray());
            if (digits.Length == 0) return null;

            foreach (var (prefix, scenarioCode) in Rules)
            {
                if (digits.StartsWith(prefix))
                    return TaxScenarios.Find(scenarioCode);
            }
            return null;
        }
    }
}
