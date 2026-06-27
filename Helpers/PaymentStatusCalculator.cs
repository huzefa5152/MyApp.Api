namespace MyApp.Api.Helpers
{
    /// <summary>Derived payment state of an invoice / purchase bill — computed at
    /// READ time from (grand total, amount paid, due date) so "Overdue" stays
    /// correct as the calendar advances without needing a write. Mirrors the
    /// statuses observed in the reference product (design §11.3).</summary>
    public enum PaymentStatus
    {
        /// <summary>Nothing paid and either no due date or the due date hasn't passed.</summary>
        Unpaid = 0,
        /// <summary>Part paid (0 &lt; balance &lt; total) and not overdue.</summary>
        PartiallyPaid = 1,
        /// <summary>Balance ≤ 0 — paid in full.</summary>
        Paid = 2,
        /// <summary>Balance &gt; 0 and the due date is in the past.</summary>
        Overdue = 3,
    }

    /// <summary>Pure functions that turn (grandTotal, amountPaid, dueDate) into the
    /// balance due, payment status, and days overdue shown on invoice/bill lists
    /// and detail. No state, no DB — safe to call per-row when projecting DTOs.
    /// "Today" is evaluated in Pakistan time (see <see cref="PakistanClock"/>), so
    /// overdue flips at the Karachi midnight the operator expects.</summary>
    public static class PaymentStatusCalculator
    {
        public static decimal BalanceDue(decimal grandTotal, decimal amountPaid)
        {
            var balance = grandTotal - amountPaid;
            return balance < 0 ? 0 : balance;
        }

        public static PaymentStatus Status(decimal grandTotal, decimal amountPaid, DateTime? dueDate)
        {
            // Treat a fully/over-paid document as Paid first — a paid invoice is
            // never "overdue" even if its due date is in the past.
            if (amountPaid >= grandTotal) return PaymentStatus.Paid;
            if (dueDate.HasValue && dueDate.Value.Date < PakistanClock.Today)
                return PaymentStatus.Overdue;
            return amountPaid > 0 ? PaymentStatus.PartiallyPaid : PaymentStatus.Unpaid;
        }

        /// <summary>Whole days the document is past due (≥ 0 only when overdue).</summary>
        public static int DaysOverdue(decimal grandTotal, decimal amountPaid, DateTime? dueDate)
        {
            if (!dueDate.HasValue) return 0;
            if (amountPaid >= grandTotal) return 0;
            var days = (PakistanClock.Today - dueDate.Value.Date).Days;
            return days > 0 ? days : 0;
        }
    }
}
