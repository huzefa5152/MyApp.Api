using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Detects how a print template carries its signature image.
    ///
    /// SHARED FILE: keep byte-identical on `master` and
    /// `customize-solution-for-other`. Nothing here may reference divisions or
    /// anything else that differs between the branches.
    ///
    /// Detection only. Injecting a slot and converting a pinned reference are
    /// pure HTML rewrites performed client-side in
    /// myapp-frontend/src/utils/stampSlot.js and saved through the ordinary
    /// template update endpoint — implementing them twice, in two languages,
    /// would only create drift between the two copies.
    /// </summary>
    public static class StampSlot
    {
        public const string Slotted = "slotted";
        public const string Pinned = "pinned";
        public const string None = "none";

        // <span class="stamp-slot"><img class="stamp-img" src="{{stamp}}"></span>
        private static readonly Regex SlotToken =
            new(@"\{\{\s*stamp\s*\}\}", RegexOptions.Compiled);

        // The escape hatch for documents carrying two different signatures.
        private static readonly Regex PinnedToken =
            new(@"\{\{\s*stamps\.([a-z0-9_]+)\s*\}\}", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        /// <summary>slotted | pinned | none — mirrors detectStampState() in stampSlot.js.</summary>
        public static string Detect(string? html)
        {
            if (string.IsNullOrEmpty(html)) return None;
            if (SlotToken.IsMatch(html)) return Slotted;
            if (PinnedToken.IsMatch(html)) return Pinned;
            return None;
        }

        /// <summary>Slugs referenced via {{stamps.&lt;slug&gt;}}, in document order, deduped.</summary>
        public static List<string> PinnedSlugs(string? html)
        {
            var found = new List<string>();
            if (string.IsNullOrEmpty(html)) return found;
            foreach (Match m in PinnedToken.Matches(html))
            {
                var slug = m.Groups[1].Value.ToLowerInvariant();
                if (!found.Contains(slug)) found.Add(slug);
            }
            return found;
        }
    }
}
