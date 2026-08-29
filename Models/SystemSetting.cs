namespace MyApp.Api.Models
{
    /// <summary>
    /// Small key/value store for INSTALLATION-WIDE settings that are not
    /// per-company and must be changeable without a code deployment.
    ///
    /// Introduced (2026-08-30) for the FBR reference-data token: HS code and
    /// UOM reference data is identical for every tenant, but PRAL still
    /// requires a bearer token to serve it. Borrowing a tenant's own token for
    /// that is what audit H-9 forbade (PRAL's audit trail then blames the donor
    /// tenant), so the installation holds ONE token used solely for read-only
    /// reference catalogs.
    ///
    /// Values flagged <see cref="IsSensitive"/> are stored encrypted via
    /// <see cref="MyApp.Api.Helpers.IFbrTokenProtector"/> (the same Data
    /// Protection key ring as Company.FbrToken) and are never returned to the
    /// client — the API exposes a masked preview only.
    /// </summary>
    public class SystemSetting
    {
        public int Id { get; set; }

        /// <summary>Stable machine key, e.g. "Fbr.ReferenceToken". Unique.</summary>
        public string Key { get; set; } = "";

        /// <summary>Raw value, or the protected payload when <see cref="IsSensitive"/>.</summary>
        public string? Value { get; set; }

        /// <summary>True when <see cref="Value"/> holds a credential.</summary>
        public bool IsSensitive { get; set; }

        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>User id of the last writer — settings here are admin-grade.</summary>
        public int? UpdatedByUserId { get; set; }
    }

    /// <summary>Known <see cref="SystemSetting.Key"/> values.</summary>
    public static class SystemSettingKeys
    {
        /// <summary>PRAL bearer token used ONLY for read-only reference catalogs.</summary>
        public const string FbrReferenceToken = "Fbr.ReferenceToken";

        /// <summary>"sandbox" or "production" — which PRAL gateway the reference token belongs to.</summary>
        public const string FbrReferenceEnvironment = "Fbr.ReferenceEnvironment";
    }
}
