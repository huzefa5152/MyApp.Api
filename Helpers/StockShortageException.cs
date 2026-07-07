namespace MyApp.Api.Helpers
{
    /// <summary>
    /// One line's shortfall when an availability guard blocks a write.
    /// </summary>
    public record StockShortageDetail(int ItemTypeId, string ItemName, decimal Required, decimal Available);

    /// <summary>
    /// Thrown when a hard-block availability guard refuses a document because
    /// stock (physical on the sell side, available = on-hand − committed on the
    /// reserve side) is insufficient. Mapped to HTTP 409 Conflict by
    /// GlobalExceptionMiddleware; the message carries the per-item shortfall.
    /// </summary>
    public class StockShortageException : Exception
    {
        public IReadOnlyList<StockShortageDetail> Shortages { get; }

        public StockShortageException(string message, IReadOnlyList<StockShortageDetail> shortages)
            : base(message)
        {
            Shortages = shortages;
        }
    }
}
