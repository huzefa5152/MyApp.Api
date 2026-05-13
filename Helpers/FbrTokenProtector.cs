using Microsoft.AspNetCore.DataProtection;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Audit C-1 (2026-05-13): encrypts <c>Company.FbrToken</c> at rest
    /// using ASP.NET Core Data Protection. Pre-fix the column stored the
    /// PRAL bearer token in plaintext — a DB dump or any read-only SQL
    /// grant let an attacker impersonate tax submissions for every tenant.
    ///
    /// Operates on a single purpose string ("MyApp.FbrToken.v1") so
    /// rotated keys stay backward-compatible: an old payload still
    /// decrypts under the new key ring until DataProtection retires
    /// the old key naturally.
    ///
    /// Idempotent on reads: payloads written before this protector
    /// existed (plaintext) fail to unprotect and are returned as-is,
    /// then encrypted on the next save. Operators don't need to run
    /// a migration script.
    /// </summary>
    public interface IFbrTokenProtector
    {
        /// <summary>Encrypt a plaintext token before persistence. Null/empty pass through.</summary>
        string? Protect(string? plaintext);

        /// <summary>Decrypt a stored token. Plaintext (legacy) payloads pass through.</summary>
        string? Unprotect(string? payload);
    }

    public sealed class FbrTokenProtector : IFbrTokenProtector
    {
        private const string Purpose = "MyApp.FbrToken.v1";
        // Marker prefix added on encrypt — lets Unprotect() distinguish
        // a ciphertext blob from a legacy plaintext token. ASP.NET
        // DataProtection-generated payloads are base64-url with no
        // colons, so the colon-bracketed prefix is unambiguous.
        private const string CipherPrefix = "enc:v1:";

        private readonly IDataProtector _protector;
        private readonly ILogger<FbrTokenProtector> _logger;

        public FbrTokenProtector(IDataProtectionProvider provider, ILogger<FbrTokenProtector> logger)
        {
            _protector = provider.CreateProtector(Purpose);
            _logger = logger;
        }

        public string? Protect(string? plaintext)
        {
            if (string.IsNullOrEmpty(plaintext)) return plaintext;
            // Don't double-encrypt — if the input already has our marker,
            // return as-is. Defensive against repeated calls.
            if (plaintext.StartsWith(CipherPrefix, StringComparison.Ordinal)) return plaintext;
            return CipherPrefix + _protector.Protect(plaintext);
        }

        public string? Unprotect(string? payload)
        {
            if (string.IsNullOrEmpty(payload)) return payload;
            // Legacy plaintext path — payloads written before this
            // service existed are returned untouched so the FBR client
            // keeps working. Next save will encrypt them.
            if (!payload.StartsWith(CipherPrefix, StringComparison.Ordinal)) return payload;

            var blob = payload[CipherPrefix.Length..];
            try
            {
                return _protector.Unprotect(blob);
            }
            catch (Exception ex)
            {
                // Key ring rotated past retention OR payload corrupted —
                // log and fail closed (return null so callers see "no
                // token configured" and surface a clear error to the
                // operator).
                _logger.LogError(ex, "FbrToken unprotect failed — payload is corrupt or the data-protection key ring no longer contains the key used to encrypt it.");
                return null;
            }
        }
    }
}
