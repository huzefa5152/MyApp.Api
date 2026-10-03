using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers.Onboarding;

namespace MyApp.Api.Controllers;

public partial class McpController
{
    private static void AddOnboardingTools(List<ExpandedTool> tools)
    {
        tools.Add(new("get_onboarding_schema", "Allowed canonical import sheets and columns. Identifiers remain text; unknown or unauthorized sheets are refused.",
            ExpandedSchema(new { companyId = new { type = "integer", minimum = 1 }, sheets = new { type = "string", maxLength = 100, description = "Comma-separated canonical sheet keys; omit for permitted sheets." } }, "companyId"),
            new[] { "onboarding.import.run" }));
        tools.Add(new("get_company_onboarding_status", "Permission-filtered company setup, master-data counts and print defaults. No credentials or tax identifiers; financial opening imports are unsupported.",
            ExpandedSchema(new { companyId = new { type = "integer", minimum = 1 } }, "companyId"), new[] { "onboarding.import.run" }));
    }

    private async Task<object> CallOnboardingToolAsync(string name, JsonElement args) => name switch
    {
        "get_onboarding_schema" => await OnboardingSchemaAsync(args),
        "get_company_onboarding_status" => await OnboardingStatusAsync(args),
        _ => throw new ToolError("Unknown onboarding tool."),
    };

    private async Task<object> OnboardingSchemaAsync(JsonElement args)
    {
        await Need("onboarding.import.run");
        var companyId = await CompanyArg(args);
        var requested = OptText(args, "sheets", 100);
        var explicitAsk = !string.IsNullOrWhiteSpace(requested);
        var keys = explicitAsk
            ? requested!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            : OnboardingSheets.ImportOrder;
        if (keys.Length == 0 || keys.Any(key => OnboardingSchema.Find(key) == null))
            throw new ToolError("Unknown onboarding sheet. Use customers, items, suppliers or openingStock.");
        var allowed = new List<OnboardingSheet>();
        foreach (var key in OnboardingSheets.ImportOrder.Where(key => keys.Contains(key, StringComparer.OrdinalIgnoreCase)))
        {
            var sheet = OnboardingSchema.Find(key)!;
            if (await _permissions.HasPermissionAsync(CurrentUserId, sheet.PermissionKey)) allowed.Add(sheet);
            else if (explicitAsk) throw new ToolError("You do not have permission to import one of the requested sheets.");
        }
        return new
        {
            companyId, maxRowsPerSheet = OnboardingSchema.MaxRowsPerSheet,
            identifierRule = "Keep identifiers as text. Never infer missing identifiers or opening quantities.",
            existingRecordRule = "Existing records and opening balances are skipped, never overwritten.",
            sheets = allowed.Select(sheet => new
            {
                key = sheet.Key, title = sheet.Title, purpose = sheet.Purpose,
                columns = sheet.Columns.Select(column => new
                {
                    key = column.Key, heading = column.Heading, kind = column.Kind.ToString().ToLowerInvariant(),
                    requirement = column.Requirement.ToString().ToLowerInvariant(), help = column.Help,
                    listSource = column.List.ToString(), maxLength = column.MaxLength,
                }).ToArray(),
            }).ToArray(),
            financialOpeningImportSupported = false,
        };
    }

    private async Task<object> OnboardingStatusAsync(JsonElement args)
    {
        await Need("onboarding.import.run");
        var companyId = await CompanyArg(args);
        var sections = new Dictionary<string, object>();
        var unavailable = new List<string>();
        if (await _permissions.HasPermissionAsync(CurrentUserId, "companies.manage.view"))
        {
            var company = await _context.Companies.AsNoTracking().Where(c => c.Id == companyId)
                .Select(c => new { hasName = c.Name != "", hasSellerRegistration = c.FbrSellerRegistrationNo != null && c.FbrSellerRegistrationNo != "", hasProvince = c.FbrProvinceCode != null }).SingleOrDefaultAsync();
            if (company == null) throw new ToolError("Company not found.");
            sections["companySetup"] = company;
        }
        else unavailable.Add("companySetup");
        if (await _permissions.HasPermissionAsync(CurrentUserId, "companies.manage.fbrtoken"))
            sections["fbrConnection"] = new { tokenConfigured = await _context.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.FbrToken != null && c.FbrToken != "").SingleAsync(), note = "Local configuration check only; FBR connectivity and document readiness are not verified." };
        else unavailable.Add("fbrConnection");
        if (await _permissions.HasPermissionAsync(CurrentUserId, "clients.manage.view"))
            sections["customers"] = new { count = await _context.Clients.AsNoTracking().CountAsync(c => c.CompanyId == companyId) };
        else unavailable.Add("customers");
        if (await _permissions.HasPermissionAsync(CurrentUserId, "suppliers.manage.view"))
            sections["suppliers"] = new { count = await _context.Suppliers.AsNoTracking().CountAsync(c => c.CompanyId == companyId) };
        else unavailable.Add("suppliers");
        if (await _permissions.HasPermissionAsync(CurrentUserId, "itemtypes.manage.view"))
            sections["items"] = new { count = await _context.ItemTypes.AsNoTracking().CountAsync(c => c.CompanyId == companyId && !c.IsDeleted) };
        else unavailable.Add("items");
        if (await _permissions.HasPermissionAsync(CurrentUserId, "stock.dashboard.view"))
            sections["inventory"] = new { trackingEnabled = await _context.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.InventoryTrackingEnabled).SingleAsync(), openingBalanceCount = await _context.OpeningStockBalances.AsNoTracking().CountAsync(c => c.CompanyId == companyId) };
        else unavailable.Add("inventory");
        if (await _permissions.HasPermissionAsync(CurrentUserId, "printtemplates.manage.view"))
        {
            var defaults = await _context.PrintTemplates.AsNoTracking().Where(c => c.CompanyId == companyId && c.IsDefault).Select(c => c.TemplateType).Distinct().ToArrayAsync();
            var types = new[] { "Challan", "Bill", "TaxInvoice", "SalesQuote", "SalesOrder", "PurchaseBill", "GoodsReceipt", "DebitNote", "CreditNote", "Receipt", "Payment", "WithholdingTaxReceipt" };
            sections["printDefaults"] = new { configuredTypes = defaults, missingSavedDefaults = types.Except(defaults).ToArray(), note = "Missing saved defaults may use application fallback layouts." };
        }
        else unavailable.Add("printDefaults");
        return new { companyId, sections, unavailableSections = unavailable, financialOpeningImportSupported = false, historicalTransactionImportSupported = false, stockValuationImportSupported = false };
    }
}
