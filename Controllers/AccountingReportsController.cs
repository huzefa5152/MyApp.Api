using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The accounting reports. Every endpoint takes its companyId on the route
    /// and carries <c>[AuthorizeCompany]</c>, so the scope of a report is
    /// decided here and never widened by a query parameter — the service has no
    /// way to be asked for two companies at once.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/accounting/reports")]
    public class AccountingReportsController : ControllerBase
    {
        private readonly IAccountingReportService _reports;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<AccountingReportsController> _logger;

        public AccountingReportsController(
            IAccountingReportService reports, ICompanyAccessGuard access,
            ILogger<AccountingReportsController> logger)
        {
            _reports = reports;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        private ActionResult Failed(Exception ex, string what, int companyId)
        {
            _logger.LogError(ex, "{What} failed for company {CompanyId}", what, companyId);
            return StatusCode(500, new { error = $"Could not build the {what}." });
        }

        [HttpGet("company/{companyId}/balance-sheet")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<BalanceSheetDto>> BalanceSheet(int companyId, [FromQuery] DateTime? asOf = null)
        {
            try { return Ok(await _reports.GetBalanceSheetAsync(companyId, asOf)); }
            catch (Exception ex) { return Failed(ex, "balance sheet", companyId); }
        }

        [HttpGet("company/{companyId}/profit-and-loss")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ProfitAndLossDto>> ProfitAndLoss(
            int companyId, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            try { return Ok(await _reports.GetProfitAndLossAsync(companyId, from, to)); }
            catch (Exception ex) { return Failed(ex, "profit and loss", companyId); }
        }

        [HttpGet("company/{companyId}/party-ledger")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PartyLedgerDto>> PartyLedger(
            int companyId, [FromQuery] string partyType, [FromQuery] int partyId,
            [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            try
            {
                var dto = await _reports.GetPartyLedgerAsync(companyId, partyType, partyId, from, to);
                // Null covers both "no such party" and "a party of another
                // company" — one answer for both, so the endpoint can't be used
                // to find out which other companies have which clients.
                return dto == null ? NotFound() : Ok(dto);
            }
            catch (Exception ex) { return Failed(ex, "party ledger", companyId); }
        }

        [HttpGet("company/{companyId}/aged-receivables")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<AgedReportDto>> AgedReceivables(int companyId, [FromQuery] DateTime? asOf = null)
        {
            try { return Ok(await _reports.GetAgedReceivablesAsync(companyId, asOf)); }
            catch (Exception ex) { return Failed(ex, "aged receivables", companyId); }
        }

        [HttpGet("company/{companyId}/aged-payables")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<AgedReportDto>> AgedPayables(int companyId, [FromQuery] DateTime? asOf = null)
        {
            try { return Ok(await _reports.GetAgedPayablesAsync(companyId, asOf)); }
            catch (Exception ex) { return Failed(ex, "aged payables", companyId); }
        }

        [HttpGet("company/{companyId}/cash-book")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<CashBookDto>> CashBook(
            int companyId, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            try { return Ok(await _reports.GetCashBookAsync(companyId, from, to)); }
            catch (Exception ex) { return Failed(ex, "cash book", companyId); }
        }

        [HttpGet("company/{companyId}/expenses")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<ExpenseReportDto>> Expenses(
            int companyId, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            try { return Ok(await _reports.GetExpenseReportAsync(companyId, from, to)); }
            catch (Exception ex) { return Failed(ex, "expense report", companyId); }
        }

        [HttpGet("company/{companyId}/tax-control")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<TaxControlDto>> TaxControl(
            int companyId, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            try { return Ok(await _reports.GetTaxControlAsync(companyId, from, to)); }
            catch (Exception ex) { return Failed(ex, "tax control report", companyId); }
        }

        [HttpGet("company/{companyId}/dashboard")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<AccountingDashboardDto>> Dashboard(
            int companyId, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            try { return Ok(await _reports.GetDashboardAsync(companyId, from, to)); }
            catch (Exception ex) { return Failed(ex, "accounting dashboard", companyId); }
        }
    }
}
