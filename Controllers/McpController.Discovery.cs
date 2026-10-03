using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Helpers;

namespace MyApp.Api.Controllers;

public partial class McpController
{
    private sealed record ExpandedTool(string Name, string Description, object InputSchema,
        string[] Permissions, string Scope = "read", bool SeedOnly = false, bool Writes = false)
    {
        public object Descriptor() => new
        {
            name = Name, description = Description, inputSchema = InputSchema,
            annotations = new { readOnlyHint = !Writes, destructiveHint = false, idempotentHint = true, openWorldHint = false }
        };
    }

    private static object ExpandedSchema(object properties, params string[] required) =>
        new { type = "object", properties, required, additionalProperties = false };

    private static readonly ExpandedTool[] ExpandedTools = BuildExpandedTools();

    private static ExpandedTool[] BuildExpandedTools()
    {
        var tools = new List<ExpandedTool>
        {
            new("get_mcp_capabilities", "Compact effective access and available tool names. No business records or secrets.",
                ExpandedSchema(new { }), Array.Empty<string>()),
            new("get_action_status", "Read this token's prepared action outcome. An unknown outcome is not success; do not retry blindly.",
                ExpandedSchema(new { planId = new { type = "string", maxLength = 64 } }, "planId"), Array.Empty<string>())
        };
        AddPrintTools(tools);
        AddDocumentPrintTools(tools);
        AddOnboardingTools(tools);
        AddOperationsTools(tools);
        return tools.ToArray();
    }

    private async Task<bool> ExpandedToolAllowedAsync(ExpandedTool tool)
    {
        if (tool.SeedOnly && !_permissions.IsSeedAdmin(CurrentUserId)) return false;
        if (!await _permissions.HasMcpToolAccessAsync(CurrentUserId, tool.Name)) return false;
        if (Agent != null && !Agent.HasScope(tool.Scope)) return false;
        if (tool.Writes && (Agent is not { AllowWrites: true }
            || !await _permissions.HasPermissionAsync(CurrentUserId, "mcp.write.use"))) return false;
        if (tool.Permissions.Length == 0) return true;
        foreach (var key in tool.Permissions)
            if (await _permissions.HasPermissionAsync(CurrentUserId, key)) return true;
        return false;
    }

    private async Task<IEnumerable<object>> ExpandedCatalogueAsync()
    {
        var tools = new List<object>();
        foreach (var tool in ExpandedTools)
            if (await ExpandedToolAllowedAsync(tool)) tools.Add(tool.Descriptor());
        return tools;
    }

    private async Task<bool> LegacyToolAllowedAsync(string name)
    {
        if (!await _permissions.HasMcpToolAccessAsync(CurrentUserId, name)) return false;
        var keys = name switch
        {
            "list_companies" => Array.Empty<string>(),
            "search_clients" => new[] { "clients.manage.view" },
            "search_invoices" or "get_invoice" => new[] { "bills.list.view", "invoices.list.view" },
            "get_stock" => new[] { "stock.dashboard.view" },
            "search_quotes" => new[] { "salesquotes.list.view" },
            "search_challans" or "get_challan" => new[] { "challans.list.view" },
            "sales_summary" => new[] { "reports.sales.view" },
            "outstanding_ledger" or "receivables_by_client" => new[] { "reports.outstanding.view" },
            "tax_sheet_summary" => new[] { "reports.taxsheet.view" },
            "item_rate_history" => new[] { "itemratehistory.view" },
            "prepare_client" => new[] { "clients.manage.create", "clients.manage.update" },
            "prepare_quote" => new[] { "salesquotes.manage.create" },
            "prepare_challan" => new[] { "challans.manage.create" },
            "prepare_bill" => new[] { "bills.manage.create", "bills.manage.create.standalone" },
            _ => throw new ToolError("Unknown tool.")
        };
        if (keys.Length == 0) return true;
        foreach (var key in keys)
            if (await _permissions.HasPermissionAsync(CurrentUserId, key)) return true;
        return false;
    }

    private async Task<object> CallExpandedToolAsync(string name, JsonElement args)
    {
        var tool = ExpandedTools.SingleOrDefault(t => t.Name == name) ?? throw new ToolError("Unknown tool.");
        if (!await ExpandedToolAllowedAsync(tool)) throw new ToolError("Resource unavailable or access denied.");
        ValidateExpandedArguments(tool, args);
        return name switch
        {
            "get_mcp_capabilities" => await GetCapabilitiesAsync(),
            "get_action_status" => await GetActionStatusAsync(args),
            "list_print_templates" or "get_print_template" or "get_print_contract" => await CallPrintToolAsync(name, args),
            "get_document_print_data" => await CallDocumentPrintToolAsync(name, args),
            "get_onboarding_schema" or "get_company_onboarding_status" => await CallOnboardingToolAsync(name, args),
            _ => await CallOperationsToolAsync(name, args)
        };
    }

    private static void ValidateExpandedArguments(ExpandedTool tool, JsonElement args)
    {
        var schema = JsonSerializer.SerializeToElement(tool.InputSchema);
        var props = schema.GetProperty("properties");
        if (args.ValueKind == JsonValueKind.Object)
            foreach (var arg in args.EnumerateObject())
                if (!props.TryGetProperty(arg.Name, out _)) throw new ToolError($"Unknown argument: {arg.Name}.");
        foreach (var key in schema.GetProperty("required").EnumerateArray())
            if (!Has(args, key.GetString()!)) throw new ToolError($"{key.GetString()} is required.");
    }

    private async Task<object> GetCapabilitiesAsync()
    {
        var companies = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
        var allowed = companies.Where(AgentAllows).Order().ToArray();
        var names = new List<string>();
        foreach (var tool in await ToolCatalogueAsync())
            names.Add(JsonSerializer.SerializeToElement(tool).GetProperty("name").GetString()!);
        return new
        {
            seedAdmin = _permissions.IsSeedAdmin(CurrentUserId),
            allCompanies = _permissions.IsSeedAdmin(CurrentUserId) && Agent is { AllCompanies: true },
            companyIds = allowed,
            scopes = Agent?.Scopes.Split(',', StringSplitOptions.RemoveEmptyEntries) ?? new[] { "read" },
            writesEnabled = Agent is { AllowWrites: true } && await _permissions.HasPermissionAsync(CurrentUserId, "mcp.write.use"),
            tools = names, money = "PKR", planLifetimeSeconds = 600, maxInlineBytes = MaxBodyBytes,
            guidance = "Read only needed details. Every write targets one company and requires a reviewed plan."
        };
    }

    private async Task<object> GetActionStatusAsync(JsonElement args)
    {
        var plan = await OwnPlanAsync(OptText(args, "planId", 64));
        await PinCompanyAsync(plan.CompanyId);
        var status = plan.CommittedAt == null ? plan.ExpiresAt > DateTime.UtcNow ? "prepared" : "expired"
            : plan.ResultRef == "FAILED" ? "failedOrIncomplete"
            : !string.IsNullOrEmpty(plan.ResultRef) ? "succeeded" : "executingOrUnknown";
        return new { planId = plan.PlanId, companyId = plan.CompanyId, kind = plan.Kind, status,
            resultRef = plan.ResultRef, summary = plan.ResultSummary ?? plan.Summary,
            retrySafe = false, expiresAt = plan.ExpiresAt };
    }
}
