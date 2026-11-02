using System.Globalization;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Discount on a sales quote: per line and on the whole quote. A discount is
    /// typed as a percentage or a rupee amount and always comes off BEFORE GST,
    /// so GST is charged on what the customer actually pays.
    ///
    /// A line discount is part of the line's price: <c>LineTotal</c> is net, and
    /// the bill made from the quote takes the net unit price. The whole-quote
    /// discount stays on the quote — the bill only shows a reminder of it.
    /// </summary>
    public static class QuoteDiscount
    {
        public const int MaxReasonLength = 200;

        /// <summary>Rupees taken off <paramref name="baseAmount"/>; refuses a discount larger than it.</summary>
        public static decimal Amount(decimal baseAmount, decimal value, bool isPercent, string what)
        {
            if (value < 0) throw new InvalidOperationException($"The discount on {what} cannot be negative.");
            if (isPercent && value > 100) throw new InvalidOperationException($"The discount on {what} cannot be more than 100%.");
            if (value == 0) return 0;
            var amount = isPercent ? Math.Round(baseAmount * value / 100m, 2) : Math.Round(value, 2);
            if (amount > baseAmount) throw new InvalidOperationException($"The discount on {what} is more than its amount.");
            return amount;
        }

        public static string? CleanReason(string? reason, decimal value)
        {
            if (value == 0 || string.IsNullOrWhiteSpace(reason)) return null;
            var r = reason.Trim();
            if (r.Length > MaxReasonLength) throw new InvalidOperationException($"A discount reason can be at most {MaxReasonLength} characters.");
            return r;
        }

        /// <summary>"Less 10% (Rs 4,100): Exchange of old battery", or null without a discount.</summary>
        public static string? Note(decimal value, bool isPercent, decimal amount, string? reason)
        {
            if (amount <= 0) return null;
            var head = isPercent ? $"Less {Num(value)}% (Rs {Num(amount)})" : $"Less Rs {Num(amount)}";
            return string.IsNullOrWhiteSpace(reason) ? head : $"{head}: {reason}";
        }

        public static string Num(decimal v) => v.ToString("#,0.##", CultureInfo.InvariantCulture);
    }
}
