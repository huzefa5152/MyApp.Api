using System.Security.Cryptography;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Secrets that travel in a URL. Used by the public Customer Portal, where the
    /// token IS the access control — there is no password behind it — so the only
    /// thing standing between a stranger and a client's invoices is that the token
    /// cannot be guessed or enumerated.
    ///
    /// 32 bytes from <see cref="RandomNumberGenerator"/> (a CSPRNG, never
    /// <c>Random</c> or <c>Guid.NewGuid</c>, whose v4 layout leaks 6 fixed bits and
    /// whose generator is unspecified). That is 256 bits of entropy encoded as 43
    /// base64url characters: at a billion guesses a second the search space still
    /// outlives the planet, so no rate limit is load-bearing for secrecy — the
    /// limiter exists to stop noise, not to make guessing infeasible.
    ///
    /// base64url (RFC 4648 §5) rather than plain base64: '+' and '/' would need
    /// percent-encoding in a path segment and '=' padding invites truncation when
    /// a link is copied out of an email client.
    /// </summary>
    public static class PublicTokenGenerator
    {
        /// <summary>Entropy per token, in bytes.</summary>
        public const int TokenBytes = 32;

        /// <summary>Encoded length — 43 chars. Matches the column's max length.</summary>
        public const int TokenLength = 43;

        /// <summary>
        /// A fresh URL-safe token. Callers persist it behind a unique index and
        /// retry on the (astronomically unlikely) collision rather than probing
        /// first — a check-then-insert would race.
        /// </summary>
        public static string Create()
        {
            var bytes = RandomNumberGenerator.GetBytes(TokenBytes);
            return Convert.ToBase64String(bytes)
                .Replace('+', '-')
                .Replace('/', '_')
                .TrimEnd('=');
        }

        /// <summary>
        /// Cheap shape check before touching the database, so a junk path segment
        /// costs a string scan instead of a query. Never a substitute for the
        /// lookup itself.
        /// </summary>
        public static bool LooksValid(string? token)
        {
            if (string.IsNullOrEmpty(token) || token.Length != TokenLength) return false;
            foreach (var c in token)
            {
                var ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
                         || (c >= '0' && c <= '9') || c == '-' || c == '_';
                if (!ok) return false;
            }
            return true;
        }
    }
}
