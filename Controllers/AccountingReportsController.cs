using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The accounting reports module. Read-only; every action is company-scoped and
    /// tenant-guarded by <see cref="AuthorizeCompanyAttribute"/>.
    ///
    /// ── Division (the request's "Branch") ──
    /// Two separate things happen for every report:
    ///   1. An explicit <c>divisionId</c> filter is ASSERTED against the caller — a
    ///      restricted user asking for a branch they don't hold gets 403.
    ///   2. The caller's accessible division set is pushed onto the filter as
    ///      <c>AllowedDivisionIds</c>, so a restricted user who supplies NO filter
    ///      still cannot read another branch's figures. Omitting a filter must never
    ///      be a way to widen scope.
    /// That field is <c>[BindNever]</c>, so it can only ever be set here.
    ///
    /// ── Export ──
    /// One generic <c>export/{reportId}</c> action rather than an <c>/excel</c> twin
    /// per report: the export permission and the workbook plumbing then exist in
    /// exactly one place, and a new report becomes exportable by adding a case.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/accounting/reports")]
    public class AccountingReportsController : LoggedControllerBase
    {
        private readonly IAccountingReportService _reports;
        private readonly IDivisionAccessGuard _divisionAccess;

        public AccountingReportsController(IAccountingReportService reports,
            IDivisionAccessGuard divisionAccess, ILogger<AccountingReportsController> logger)
            : base(logger)
        {
            _reports = reports;
            _divisionAccess = divisionAccess;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // ── Expenses ──────────────────────────────────────────────────────────────

        /// <summary>Company Expense Report — detail rows plus by-Account and by-Payee
        /// breakdowns. The answer to "where did the money go".</summary>
        [HttpGet("company/{companyId}/expenses")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> Expenses(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetExpenseReportAsync(companyId, filter));
        }

        /// <summary>Expense Detail — the same rows without the summary blocks, for
        /// operators who want a flat list to page and sort.</summary>
        [HttpGet("company/{companyId}/expenses/detail")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> ExpenseDetail(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetExpenseReportAsync(companyId, filter, includeGroupSummaries: false));
        }

        /// <summary>
        /// The "Expenses by X" family. <paramref name="groupBy"/>:
        /// account | payee | group | date | month | paymentAccount | tax.
        /// Also serves Expense Summary (groupBy=account) and Monthly Expenses (month).
        /// </summary>
        [HttpGet("company/{companyId}/expenses/summary")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> ExpenseSummary(
            int companyId, [FromQuery] ReportFilterDto filter, [FromQuery] string groupBy = "account")
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetExpenseSummaryAsync(companyId, filter, groupBy));
        }

        // ── Cash & bank ───────────────────────────────────────────────────────────

        [HttpGet("company/{companyId}/cash-book")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<CashBookResultDto>> CashBook(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetCashBookAsync(companyId, filter, "cash"));
        }

        [HttpGet("company/{companyId}/bank-book")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<CashBookResultDto>> BankBook(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetCashBookAsync(companyId, filter, "bank"));
        }

        [HttpGet("company/{companyId}/cash-bank-summary")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> CashBankSummary(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetCashBankSummaryAsync(companyId, filter));
        }

        [HttpGet("company/{companyId}/receipts-register")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> ReceiptsRegister(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetMoneyRegisterAsync(companyId, filter, receipts: true));
        }

        [HttpGet("company/{companyId}/payments-register")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> PaymentsRegister(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetMoneyRegisterAsync(companyId, filter, receipts: false));
        }

        [HttpGet("company/{companyId}/receipts-by-account")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> ReceiptsByAccount(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetMoneyByAccountAsync(companyId, filter, receipts: true));
        }

        [HttpGet("company/{companyId}/payments-by-account")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> PaymentsByAccount(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetMoneyByAccountAsync(companyId, filter, receipts: false));
        }

        /// <summary>Cheques received and not yet cleared — money we are counting on.</summary>
        [HttpGet("company/{companyId}/cheques-in-hand")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> ChequesInHand(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetChequeRegisterAsync(companyId, filter, issued: false));
        }

        /// <summary>Cheques written and not yet cleared — money about to leave.</summary>
        [HttpGet("company/{companyId}/cheques-issued")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> ChequesIssued(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetChequeRegisterAsync(companyId, filter, issued: true));
        }

        [HttpGet("company/{companyId}/unallocated")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> Unallocated(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetUnallocatedPaymentsAsync(companyId, filter));
        }

        // ── Customers ─────────────────────────────────────────────────────────────

        /// <summary>Customer Ledger — one customer or all, any period including
        /// all-time. Ledger-sourced, so notes, advances and journals are in.</summary>
        [HttpGet("company/{companyId}/customer-ledger")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PartyLedgerResultDto>> CustomerLedger(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPartyLedgerAsync(companyId, filter, customers: true));
        }

        /// <summary>Customer Statement — the same figures laid out to send to the
        /// customer, with an age breakdown of what they owe.</summary>
        [HttpGet("company/{companyId}/customer-statement")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PartyLedgerResultDto>> CustomerStatement(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPartyLedgerAsync(companyId, filter,
                customers: true, asStatement: true));
        }

        [HttpGet("company/{companyId}/customer-balances")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PartyBalanceSummaryDto>> CustomerBalances(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPartyBalanceSummaryAsync(companyId, filter, customers: true));
        }

        // Named receivables-aging, not aged-receivables: AccountingController
        // already serves api/accounting/reports/company/{id}/aged-receivables as
        // the raw primitive (the dashboard and the GL tests use it), and two
        // controllers claiming one route is an AmbiguousMatchException at runtime.
        [HttpGet("company/{companyId}/receivables-aging")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> AgedReceivables(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetAgingReportAsync(companyId, filter, customers: true));
        }

        [HttpGet("company/{companyId}/customer-outstanding")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> CustomerOutstanding(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetOutstandingDocumentsAsync(companyId, filter, customers: true));
        }

        /// <summary>Customer Sales — what each customer bought, by item and item
        /// type. Also the honest answer to "customer purchase history": what they
        /// purchased FROM US, since customers do not raise purchases here.</summary>
        [HttpGet("company/{companyId}/customer-sales")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> CustomerSales(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPartyTradeAsync(companyId, filter, customers: true));
        }

        // ── Suppliers ─────────────────────────────────────────────────────────────

        [HttpGet("company/{companyId}/supplier-ledger")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PartyLedgerResultDto>> SupplierLedger(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPartyLedgerAsync(companyId, filter, customers: false));
        }

        [HttpGet("company/{companyId}/supplier-statement")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PartyLedgerResultDto>> SupplierStatement(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPartyLedgerAsync(companyId, filter,
                customers: false, asStatement: true));
        }

        [HttpGet("company/{companyId}/supplier-balances")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PartyBalanceSummaryDto>> SupplierBalances(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPartyBalanceSummaryAsync(companyId, filter, customers: false));
        }

        // See the note on receivables-aging above.
        [HttpGet("company/{companyId}/payables-aging")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> AgedPayables(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetAgingReportAsync(companyId, filter, customers: false));
        }

        [HttpGet("company/{companyId}/supplier-outstanding")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> SupplierOutstanding(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetOutstandingDocumentsAsync(companyId, filter, customers: false));
        }

        [HttpGet("company/{companyId}/supplier-purchases")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> SupplierPurchases(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPartyTradeAsync(companyId, filter, customers: false));
        }

        // ── Financial statements ──────────────────────────────────────────────────

        /// <summary>Balance Sheet as at the period end. <c>comparative=true</c> adds
        /// the same date a year earlier.</summary>
        [HttpGet("company/{companyId}/balance-sheet")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<StatementResultDto>> BalanceSheet(
            int companyId, [FromQuery] ReportFilterDto filter, [FromQuery] bool comparative = true)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetBalanceSheetAsync(companyId, filter, comparative));
        }

        /// <summary>Profit &amp; Loss for the period. <c>comparative=true</c> adds the
        /// preceding period of the same length.</summary>
        [HttpGet("company/{companyId}/profit-loss")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<StatementResultDto>> ProfitAndLoss(
            int companyId, [FromQuery] ReportFilterDto filter, [FromQuery] bool comparative = true)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetProfitAndLossAsync(companyId, filter, comparative));
        }

        [HttpGet("company/{companyId}/general-ledger")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> GeneralLedger(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetGeneralLedgerAsync(companyId, filter));
        }

        [HttpGet("company/{companyId}/account-balances")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> AccountBalances(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetAccountBalanceSummaryAsync(companyId, filter));
        }

        // trial-balance-report, not trial-balance: AccountingController already owns
        // api/accounting/reports/company/{id}/trial-balance as the raw primitive,
        // and two controllers on one route is a runtime AmbiguousMatchException.
        [HttpGet("company/{companyId}/trial-balance-report")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> TrialBalanceReport(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetTrialBalanceReportAsync(companyId, filter));
        }

        // ── Sales & purchases ─────────────────────────────────────────────────────

        [HttpGet("company/{companyId}/sales-register")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> SalesRegister(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetDocumentRegisterAsync(companyId, filter, sales: true));
        }

        [HttpGet("company/{companyId}/purchase-register")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> PurchaseRegister(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetDocumentRegisterAsync(companyId, filter, sales: false));
        }

        [HttpGet("company/{companyId}/sales-payment-status")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> SalesPaymentStatus(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPaymentStatusAsync(companyId, filter, sales: true));
        }

        [HttpGet("company/{companyId}/purchase-payment-status")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> PurchasePaymentStatus(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetPaymentStatusAsync(companyId, filter, sales: false));
        }

        /// <summary>Sales by customer | item | itemType | account | date | month | tax.</summary>
        [HttpGet("company/{companyId}/sales-summary")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> SalesSummary(
            int companyId, [FromQuery] ReportFilterDto filter, [FromQuery] string groupBy = "party")
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetDocumentSummaryAsync(companyId, filter, true, groupBy));
        }

        /// <summary>Purchases by supplier | item | itemType | account | date | month | tax.</summary>
        [HttpGet("company/{companyId}/purchase-summary")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> PurchaseSummary(
            int companyId, [FromQuery] ReportFilterDto filter, [FromQuery] string groupBy = "party")
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetDocumentSummaryAsync(companyId, filter, false, groupBy));
        }

        [HttpGet("company/{companyId}/credit-debit-notes")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ReportResultDto>> CreditDebitNotes(
            int companyId, [FromQuery] ReportFilterDto filter)
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;
            return Ok(await _reports.GetNotesReportAsync(companyId, filter));
        }

        // ── Export ────────────────────────────────────────────────────────────────

        /// <summary>
        /// Styled .xlsx of any report, by the same id the frontend registry uses.
        /// Exports the WHOLE filtered set (not the visible page) up to the builder's
        /// row ceiling, which is what an accountant expects from an export; the
        /// workbook states it if the ceiling truncated the data.
        /// </summary>
        [HttpGet("company/{companyId}/export/{reportId}")]
        [HasPermission("accounting.reports.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> Export(
            int companyId, string reportId, [FromQuery] ReportFilterDto filter,
            [FromQuery] string groupBy = "account")
        {
            if (await PrepareAsync(companyId, filter) is { } bad) return bad;

            ReportResultDto report;
            switch ((reportId ?? "").Trim().ToLowerInvariant())
            {
                case "expenses":
                    report = await _reports.GetExpenseReportAsync(companyId, filter, true, forExport: true); break;
                case "expenses-detail":
                    report = await _reports.GetExpenseReportAsync(companyId, filter, false, forExport: true); break;
                case "expenses-summary":
                    report = await _reports.GetExpenseSummaryAsync(companyId, filter, groupBy); break;
                case "cash-book":
                    report = await _reports.GetCashBookAsync(companyId, filter, "cash"); break;
                case "bank-book":
                    report = await _reports.GetCashBookAsync(companyId, filter, "bank"); break;
                case "cash-bank-summary":
                    report = await _reports.GetCashBankSummaryAsync(companyId, filter); break;
                case "receipts-register":
                    report = await _reports.GetMoneyRegisterAsync(companyId, filter, true); break;
                case "payments-register":
                    report = await _reports.GetMoneyRegisterAsync(companyId, filter, false); break;
                case "receipts-by-account":
                    report = await _reports.GetMoneyByAccountAsync(companyId, filter, true); break;
                case "payments-by-account":
                    report = await _reports.GetMoneyByAccountAsync(companyId, filter, false); break;
                case "cheques-in-hand":
                    report = await _reports.GetChequeRegisterAsync(companyId, filter, false); break;
                case "cheques-issued":
                    report = await _reports.GetChequeRegisterAsync(companyId, filter, true); break;
                case "unallocated":
                    report = await _reports.GetUnallocatedPaymentsAsync(companyId, filter); break;
                case "customer-ledger":
                    report = await _reports.GetPartyLedgerAsync(companyId, filter, true); break;
                case "customer-statement":
                    report = await _reports.GetPartyLedgerAsync(companyId, filter, true, true); break;
                case "customer-balances":
                    report = await _reports.GetPartyBalanceSummaryAsync(companyId, filter, true); break;
                case "aged-receivables":
                    report = await _reports.GetAgingReportAsync(companyId, filter, true); break;
                case "customer-outstanding":
                    report = await _reports.GetOutstandingDocumentsAsync(companyId, filter, true); break;
                case "customer-sales":
                    report = await _reports.GetPartyTradeAsync(companyId, filter, true); break;
                case "supplier-ledger":
                    report = await _reports.GetPartyLedgerAsync(companyId, filter, false); break;
                case "supplier-statement":
                    report = await _reports.GetPartyLedgerAsync(companyId, filter, false, true); break;
                case "supplier-balances":
                    report = await _reports.GetPartyBalanceSummaryAsync(companyId, filter, false); break;
                case "aged-payables":
                    report = await _reports.GetAgingReportAsync(companyId, filter, false); break;
                case "supplier-outstanding":
                    report = await _reports.GetOutstandingDocumentsAsync(companyId, filter, false); break;
                case "supplier-purchases":
                    report = await _reports.GetPartyTradeAsync(companyId, filter, false); break;
                case "balance-sheet":
                    report = await _reports.GetBalanceSheetAsync(companyId, filter, true); break;
                case "profit-loss":
                    report = await _reports.GetProfitAndLossAsync(companyId, filter, true); break;
                case "general-ledger":
                    report = await _reports.GetGeneralLedgerAsync(companyId, filter); break;
                case "account-balances":
                    report = await _reports.GetAccountBalanceSummaryAsync(companyId, filter); break;
                case "trial-balance":
                case "trial-balance-report":
                    report = await _reports.GetTrialBalanceReportAsync(companyId, filter); break;
                case "sales-register":
                    report = await _reports.GetDocumentRegisterAsync(companyId, filter, true); break;
                case "purchase-register":
                    report = await _reports.GetDocumentRegisterAsync(companyId, filter, false); break;
                case "sales-payment-status":
                    report = await _reports.GetPaymentStatusAsync(companyId, filter, true); break;
                case "purchase-payment-status":
                    report = await _reports.GetPaymentStatusAsync(companyId, filter, false); break;
                case "sales-summary":
                    report = await _reports.GetDocumentSummaryAsync(companyId, filter, true, groupBy); break;
                case "purchase-summary":
                    report = await _reports.GetDocumentSummaryAsync(companyId, filter, false, groupBy); break;
                case "credit-debit-notes":
                    report = await _reports.GetNotesReportAsync(companyId, filter); break;
                default:
                    return BadRequest(new { message = "Unknown report." });
            }

            byte[] bytes;
            try
            {
                bytes = ReportExcelBuilder.Build(report);
            }
            catch (Exception ex)
            {
                // Never surface the exception text — it can carry schema detail.
                _logger.LogError(ex, "Excel export failed for report {ReportId}, company {CompanyId}",
                    reportId, companyId);
                return StatusCode(500, new { message = "Could not build the Excel file. Please try again." });
            }

            var fileName = $"{Slug(report.Title)}-{PakistanClock.Today:yyyy-MM-dd}.xlsx";
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName);
        }

        // ── Shared request preparation ────────────────────────────────────────────

        /// <summary>
        /// Validate the period and establish division scope. Returns an
        /// <see cref="ActionResult"/> to short-circuit with, or null to proceed.
        ///
        /// Order matters: assert the explicitly requested division FIRST (so an
        /// unauthorised request is a clear 403, not a silently empty report), then
        /// pin the caller's accessible set onto the filter.
        /// </summary>
        private async Task<ActionResult?> PrepareAsync(int companyId, ReportFilterDto filter)
        {
            var preset = ReportPeriod.ParsePreset(filter.Period);
            if (ReportPeriod.Validate(preset, filter.From, filter.To) is { } error)
                return BadRequest(new { message = error });

            // A company id that doesn't exist should 404, not return a blank report
            // with an empty letterhead. [AuthorizeCompany] can't catch this: the seed
            // admin is granted every company unconditionally, so a typo'd id sails
            // through to an empty envelope. One indexed PK lookup, on an endpoint
            // that already runs several aggregates.
            if (!await _reports.CompanyExistsAsync(companyId))
                return NotFound(new { message = "Company not found." });

            if (filter.DivisionId.HasValue)
                await _divisionAccess.AssertAccessAsync(CurrentUserId, companyId, filter.DivisionId);

            // Null = unrestricted in this company, so no scope predicate is added.
            var accessible = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            filter.AllowedDivisionIds = accessible?.ToList();

            return null;
        }

        /// <summary>Report title → safe download filename fragment.</summary>
        private static string Slug(string title)
        {
            var chars = (title ?? "Report")
                .Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')
                .ToArray();
            var slug = new string(chars);
            while (slug.Contains("--")) slug = slug.Replace("--", "-");
            return slug.Trim('-') is { Length: > 0 } s ? s : "Report";
        }
    }
}
