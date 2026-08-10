using System;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Audit H-7: distinguishes a <b>caller</b> validation error (a deliberately
    /// thrown <see cref="InvalidOperationException"/> with a user-facing message
    /// → HTTP 400) from a <b>framework/runtime internal</b> InvalidOperationException
    /// (EF LINQ translation failure, concurrent-DbContext use, Single()-on-empty,
    /// a disposed object, …) which signals a server defect → opaque HTTP 500.
    ///
    /// Historically GlobalExceptionMiddleware mapped <i>every</i>
    /// InvalidOperationException to 400 and echoed <c>ex.Message</c>, which both
    /// mis-classified real 500s as 400s and leaked internal EF/SQL detail to the
    /// client. The ~212 deliberate validation throws across the services keep
    /// their 400 + message; only the framework-internal ones are reclassified.
    /// </summary>
    public static class ExceptionClassifier
    {
        // Substring markers (matched case-insensitively) that appear only in
        // framework/runtime-thrown InvalidOperationExceptions, never in the
        // application's own validation messages.
        private static readonly string[] InternalMarkers =
        {
            "could not be translated",                         // EF Core LINQ translation
            "a second operation was started on this context",  // concurrent DbContext use
            "sequence contains no elements",                   // Single()/First() on empty
            "sequence contains more than one element",         // Single() with >1 match
            "the instance of entity type",                     // EF identity / tracking conflict
            "no database provider has been configured",        // DI / configuration bug
            "nullable object must have a value",               // Nullable<T>.Value on null
            "collection was modified",                         // enumeration mutated mid-iterate
            "there is already an open datareader",             // ADO.NET misuse
            "the connectionstring property has not been initialized",
        };

        /// <summary>
        /// True when the exception represents an internal server defect that
        /// must surface as an opaque 500 (and be logged at Error), rather than
        /// a caller-facing 400 validation message.
        /// </summary>
        public static bool IsFrameworkInternal(InvalidOperationException ex)
        {
            // ObjectDisposedException : InvalidOperationException — always a bug.
            if (ex is ObjectDisposedException) return true;

            var msg = ex.Message;
            if (string.IsNullOrEmpty(msg)) return false;

            foreach (var marker in InternalMarkers)
                if (msg.Contains(marker, StringComparison.OrdinalIgnoreCase))
                    return true;

            return false;
        }
    }
}
