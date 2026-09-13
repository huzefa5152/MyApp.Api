using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Three stored figures for one item at one moment — what an audit
    /// row records on each side of a change. A cost with no quantity beside it
    /// cannot be read, so they always travel together.</summary>
    public readonly record struct StockFigures(decimal Quantity, decimal ActualCost, decimal Value)
    {
        public bool SameAs(StockFigures other)
            => Quantity == other.Quantity && ActualCost == other.ActualCost && Value == other.Value;
    }

    /// <summary>
    /// Writes and reads <see cref="Models.StockCostChange"/> — the audit trail
    /// behind an item's actual cost. See the model for why it is its own table.
    /// </summary>
    public interface IStockCostAuditService
    {
        /// <summary>
        /// Queues one record. Deliberately does NOT call SaveChanges: every
        /// caller already owns a transaction that must commit the change and its
        /// record together or neither, and a service that saved on its own could
        /// leave a history entry for a change that then rolled back.
        ///
        /// A no-op change (all three figures identical) writes nothing — an
        /// operator pressing Save without editing anything should not leave a
        /// trail entry that says nothing happened.
        /// </summary>
        Task RecordAsync(
            int companyId, int itemTypeId, int? openingStockBalanceId,
            int? userId, string source, string? sourceRef,
            StockFigures before, StockFigures after,
            string? note = null, int? importRunId = null, int? importConsignmentId = null);

        /// <summary>Newest first. <paramref name="itemTypeId"/> narrows to one
        /// item — the drill-down the stock dashboard opens.</summary>
        Task<PagedResult<StockCostChangeDto>> GetPagedAsync(
            int companyId, int? itemTypeId, int page, int? pageSize);
    }
}
