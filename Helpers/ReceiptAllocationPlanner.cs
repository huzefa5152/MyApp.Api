namespace MyApp.Api.Helpers
{
    /// <summary>One outstanding sales invoice, as the planner needs to see it.
    /// <paramref name="Collectible"/> is the invoice's cap — GrandTotal less any
    /// withheld slice — and <paramref name="AmountPaid"/> what has already been
    /// settled against it (cash + settle-remainder adjustment).</summary>
    public sealed record OutstandingInvoice(
        int Id, int InvoiceNumber, DateTime Date, decimal Collectible, decimal AmountPaid)
    {
        /// <summary>What is still claimable. Never negative: an over-settled
        /// invoice offers no headroom rather than borrowing from its neighbours.</summary>
        public decimal BalanceDue => Math.Max(0m, Collectible - AmountPaid);
    }

    /// <summary>One line the planner proposes.</summary>
    public sealed record PlannedAllocation(
        int InvoiceId, int InvoiceNumber, DateTime Date, decimal BalanceDue, decimal Amount);

    /// <summary>What the money would do: the lines, what they consume, and what
    /// is left over to sit on the customer's account.</summary>
    public sealed record AllocationPlan(
        IReadOnlyList<PlannedAllocation> Lines, decimal Applied, decimal Remainder);

    /// <summary>
    /// THE only place a receipt is spread across invoices. Oldest invoice first
    /// (FIFO), each filled to its balance before the next is touched, and
    /// whatever no invoice claims is left as the customer's advance.
    ///
    /// Deliberately PURE — no database, no service, no GL. It proposes; the
    /// caller applies through <c>PaymentService.AllocateAsync</c>, which owns
    /// every guard (cross-tenant, cross-party, over-pay, period close) and the
    /// posting. So auto-allocation can never settle something a hand-typed
    /// allocation could not.
    ///
    /// TWO RULES IT MUST KEEP, because breaking either produces lines the
    /// service will reject and the operator will read as a broken button:
    ///
    ///   • Headroom is COLLECTIBLE − AmountPaid, not GrandTotal − AmountPaid.
    ///     A withheld slice was settled by the customer at invoice time, so it
    ///     was never receivable. That is exactly the cap
    ///     <c>AssertNoInvoiceOverpayAsync</c> enforces, and the planner matches
    ///     it rather than restating it.
    ///   • It never proposes a zero line. A line that applies nothing is a row
    ///     the service refuses ("each allocation must apply a positive amount"),
    ///     and it would clutter the document with allocations that mean nothing.
    ///
    /// Ordering is Date then Id — the same tie-break <c>StockValuation</c> uses,
    /// so two invoices raised the same day are consumed in the order they were
    /// written rather than in whatever order the database returned them.
    /// </summary>
    public static class ReceiptAllocationPlanner
    {
        public static AllocationPlan Plan(IEnumerable<OutstandingInvoice> invoices, decimal available)
        {
            var lines = new List<PlannedAllocation>();
            var left = available > 0m ? available : 0m;

            foreach (var inv in (invoices ?? Enumerable.Empty<OutstandingInvoice>())
                         .OrderBy(i => i.Date).ThenBy(i => i.Id))
            {
                if (left <= 0m) break;
                var due = inv.BalanceDue;
                if (due <= 0m) continue;

                var take = Math.Min(left, due);
                lines.Add(new PlannedAllocation(inv.Id, inv.InvoiceNumber, inv.Date, due, take));
                left -= take;
            }

            var applied = lines.Sum(l => l.Amount);
            return new AllocationPlan(lines, applied, (available > 0m ? available : 0m) - applied);
        }
    }
}
