namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Result of a Manager.io → MyApp import run. Counts per entity, operator
    /// notes (skips, decisions), and the AR/AP reconciliation so the caller can
    /// confirm the imported balances match the source before trusting the data.
    /// </summary>
    public class ManagerImportReport
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public bool DryRun { get; set; }

        /// <summary>entity → rows created (divisions, clients, invoices, …).</summary>
        public Dictionary<string, int> Created { get; set; } = new();

        /// <summary>Human-readable notes: skips, on-account remainders, decisions.</summary>
        public List<string> Notes { get; set; } = new();

        // Reconciliation (PKR). AR/AP should match Manager after a full run.
        public decimal SalesTotal { get; set; }
        public decimal ArManager { get; set; }
        public decimal ArMyApp { get; set; }
        public decimal ApManager { get; set; }
        public decimal ApMyApp { get; set; }
    }
}
