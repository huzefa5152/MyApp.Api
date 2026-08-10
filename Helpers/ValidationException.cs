namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Audit H-7: the sanctioned way to signal a caller-facing 400 with a
    /// safe, human-readable message. <see cref="MyApp.Api.Middleware.GlobalExceptionMiddleware"/>
    /// maps this to HTTP 400 and passes the message through verbatim.
    ///
    /// Prefer this over throwing <see cref="System.InvalidOperationException"/>
    /// for new validation code: the intent (client error, message safe to
    /// show) is explicit and can never be mistaken for a framework-internal
    /// InvalidOperationException (EF translation failure, concurrent DbContext
    /// use, disposed object, …) which must surface as an opaque 500.
    ///
    /// Existing InvalidOperationException validation throws keep working
    /// unchanged — the middleware still maps a deliberate one to 400. This
    /// type is the forward-looking replacement, not a required migration.
    /// </summary>
    public sealed class ValidationException : System.Exception
    {
        public ValidationException(string message) : base(message) { }
        public ValidationException(string message, System.Exception inner) : base(message, inner) { }
    }
}
