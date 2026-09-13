namespace MyApp.Api.Models
{
    /// <summary>
    /// One recorded change to an item's stored stock figures — the audit trail
    /// behind <see cref="OpeningStockBalance.ActualCostExcludingTax"/>.
    ///
    /// Why this exists: the actual-cost pool is SET, not accumulated. A GD
    /// costing import in Backfill mode overwrites it outright, a New Arrivals
    /// import adds to it, a hand edit replaces it and a consignment delete
    /// reverses it — and until this table there was no record anywhere of what
    /// a figure had been before. "The margin looks wrong" could only ever be
    /// answered by re-deriving it from the sheets, which is exactly what an
    /// operator asking the question no longer trusts.
    ///
    /// Deliberately NOT <see cref="AuditLog"/>: that table is the exception log
    /// (level / status code / stack trace / fingerprint dedup), and a change
    /// record that can be collapsed into an occurrence count is not a change
    /// record. Deliberately not <see cref="StockMovement"/> either — a movement
    /// is part of the valuation walk (CLAUDE.md 5b-4) and anything written there
    /// changes the numbers it is supposed to be describing.
    ///
    /// Append-only by contract: nothing updates or deletes a row here except a
    /// company delete taking its whole history with it.
    /// </summary>
    public class StockCostChange
    {
        public int Id { get; set; }

        public int CompanyId { get; set; }
        public Company Company { get; set; } = null!;

        public int ItemTypeId { get; set; }
        public ItemType ItemType { get; set; } = null!;

        /// <summary>
        /// A PLAIN nullable column, not a foreign key, on purpose: a consignment
        /// delete removes the opening balances that import created, and the
        /// record of what happened to one has to outlive it — an FK would either
        /// block that delete or null the pointer out in a way that reads as
        /// "there was never a balance". Same reasoning as
        /// <c>Invoice.CopiedFromId</c> (CLAUDE.md 5b).
        /// </summary>
        public int? OpeningStockBalanceId { get; set; }

        public DateTime ChangedAt { get; set; } = DateTime.UtcNow;

        public int? ChangedByUserId { get; set; }

        /// <summary>Snapshotted rather than joined: a user who has since been
        /// removed must still read as the person who made the change.</summary>
        public string? ChangedByUserName { get; set; }

        /// <summary>One of <see cref="Helpers.StockCostChangeSources"/> — which
        /// code path wrote the change, so the history reads as a story rather
        /// than a list of numbers.</summary>
        public string Source { get; set; } = "";

        /// <summary>What in that source: a GD number, an adjustment mode, the
        /// screen the edit came from. Free text, never parsed.</summary>
        public string? SourceRef { get; set; }

        /// <summary>Set when the change came from a spreadsheet run, so a whole
        /// import's damage can be listed at once.</summary>
        public int? ImportRunId { get; set; }

        /// <summary>Set when the change came from a GD consignment (its commit,
        /// a line correction, or its delete).</summary>
        public int? ImportConsignmentId { get; set; }

        // ── Before / after ────────────────────────────────────────────────
        // All three stored figures, not just the cost. A cost only means
        // something against the quantity it covers, and the selling pool moves
        // in step with it on the New Arrivals path — a record showing one
        // without the others cannot answer why the margin changed.

        public decimal OldQuantity { get; set; }
        public decimal NewQuantity { get; set; }

        public decimal OldActualCostExcludingTax { get; set; }
        public decimal NewActualCostExcludingTax { get; set; }

        public decimal OldValueExcludingTax { get; set; }
        public decimal NewValueExcludingTax { get; set; }

        /// <summary>Operator-facing sentence saying what was done and why, in
        /// the words the screen that did it would use.</summary>
        public string? Note { get; set; }
    }
}
