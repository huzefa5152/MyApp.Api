using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

/// <summary>
/// Master data an agent needs before it can raise documents: suppliers and catalog items.
/// Same prepare / approve / commit cycle as clients, and commit calls the screens' own
/// services, so duplicate checks, HS validation against PRAL, unit registration and
/// supplier grouping cannot drift from the forms.
/// </summary>
public partial class McpController
{
    private const int SupplierChangesPerHour = 30;
    private const int ItemTypeChangesPerHour = 30;

    private static void AddMasterTools(List<ExpandedTool> tools)
    {
        // Local descriptors avoid partial-class static initialisation ordering.
        var company = new { type = "integer", minimum = 1 };
        var idem = new { type = "string", maxLength = 100 };
        tools.Add(new("prepare_supplier", "Prepare a new supplier, or an update when supplierId is given (only the fields you pass change). Nothing is saved: returns a plan to show the user. Call commit_action only after they approve.",
            ExpandedSchema(new
            {
                companyId = company, supplierId = new { type = "integer", minimum = 1 },
                name = new { type = "string", maxLength = 200 }, address = new { type = "string", maxLength = 500 }, phone = new { type = "string", maxLength = 50 },
                email = new { type = "string", maxLength = 200 }, ntn = new { type = "string", maxLength = 50 }, strn = new { type = "string", maxLength = 50 },
                cnic = new { type = "string", maxLength = 50 }, site = new { type = "string", maxLength = 200 },
                registrationType = new { type = "string", @enum = new[] { "Registered", "Unregistered" } }, fbrProvinceCode = new { type = "integer", minimum = 1 },
                idempotencyKey = idem,
            }, "companyId"),
            new[] { "suppliers.manage.create", "suppliers.manage.update" }, McpScopes.Suppliers, Writes: true));
        tools.Add(new("prepare_item_type", "Prepare a new catalog item for one company, or an update when itemTypeId is given (only the fields you pass change). Find the HS code with search_fbr_hs_codes; a new item without a name takes that code's shortName. The item name is what FBR receives as the product description when a bill is filed with this item (blank when the company omits descriptions). An HS code is checked against FBR's catalog when committed; leave it out to save an unclassified draft item. Nothing is saved: returns a plan to show the user. Call commit_action only after they approve.",
            ExpandedSchema(new
            {
                companyId = company, itemTypeId = new { type = "integer", minimum = 1 },
                name = new { type = "string", maxLength = 200 }, hsCode = new { type = "string", maxLength = 20 },
                uom = new { type = "string", maxLength = 50 }, saleType = new { type = "string", maxLength = 100 },
                idempotencyKey = idem,
            }, "companyId"),
            new[] { "itemtypes.manage.create", "itemtypes.manage.update" }, McpScopes.ItemTypes, Writes: true));
    }

    private async Task<object> CallMasterToolAsync(string name, JsonElement args) => name switch
    {
        "prepare_supplier" => await PrepareSupplierAsync(args),
        "prepare_item_type" => await PrepareItemTypeAsync(args),
        _ => throw new ToolError("Unknown tool."),
    };

    // ── prepare_supplier ───────────────────────────────────────────────

    private async Task<object> PrepareSupplierAsync(JsonElement args)
    {
        var agent = await RequireWriterAsync(McpScopes.Suppliers);
        var companyId = await CompanyArg(args);
        var supplierId = IntArg(args, "supplierId");
        await Need(supplierId.HasValue ? "suppliers.manage.update" : "suppliers.manage.create");
        // An update plan echoes the stored contact details back, so it needs the right that reads them.
        if (supplierId.HasValue) await Need("suppliers.manage.view");
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.Suppliers) is { } prior) return prior;

        var suppliers = OperationService<ISupplierService>();
        SupplierDto dto;
        if (supplierId.HasValue)
        {
            var existing = await suppliers.GetByIdAsync(supplierId.Value);
            if (existing == null || existing.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
            dto = existing;
        }
        else
        {
            var name0 = OptText(args, "name", 200);
            if (string.IsNullOrEmpty(name0)) throw new ToolError("name is required to create a supplier.");
            dto = new SupplierDto { CompanyId = companyId, Name = name0 };
        }
        if (Has(args, "name") && OptText(args, "name", 200) is { Length: > 0 } nm) dto.Name = nm;
        if (OptText(args, "address", 500) is { } ad) dto.Address = ad.Length == 0 ? null : ad;
        if (OptText(args, "phone", 50) is { } ph) dto.Phone = ph.Length == 0 ? null : ph;
        if (OptText(args, "email", 200) is { } em) dto.Email = em.Length == 0 ? null : em;
        if (OptText(args, "ntn", 50) is { } nt) dto.NTN = nt.Length == 0 ? null : nt;
        if (OptText(args, "strn", 50) is { } st) dto.STRN = st.Length == 0 ? null : st;
        if (OptText(args, "cnic", 50) is { } cn) dto.CNIC = cn.Length == 0 ? null : cn;
        if (OptText(args, "site", 200) is { } si) dto.Site = si.Length == 0 ? null : si;
        if (OptText(args, "registrationType", 20) is { } rt)
        {
            if (rt is not ("Registered" or "Unregistered")) throw new ToolError("registrationType must be Registered or Unregistered.");
            dto.RegistrationType = rt;
        }
        if (Has(args, "fbrProvinceCode"))
            dto.FbrProvinceCode = IntArg(args, "fbrProvinceCode") is { } pc and > 0 ? pc : throw new ToolError("fbrProvinceCode must be a positive integer.");
        if (dto.Email != null && !dto.Email.Contains('@')) throw new ToolError("email does not look like an email address.");

        // The service's name rule, surfaced now instead of at commit.
        var clash = (await suppliers.GetByCompanyAsync(companyId))
            .FirstOrDefault(s => s.Id != dto.Id && string.Equals(s.Name, dto.Name, StringComparison.OrdinalIgnoreCase));
        if (clash != null) throw new ToolError($"A supplier named \"{clash.Name}\" already exists in this company (id {clash.Id}).");

        var kind = supplierId.HasValue ? "supplier.update" : "supplier.create";
        var payload = new
        {
            dto.Id, dto.CompanyId, dto.Name, dto.Address, dto.Phone, dto.Email, dto.NTN, dto.STRN, dto.CNIC, dto.Site,
            dto.RegistrationType, dto.FbrProvinceCode,
        };
        var summary = supplierId.HasValue
            ? $"Update supplier #{dto.Id} \"{dto.Name}\" in company {companyId}"
            : $"Create supplier \"{dto.Name}\" in company {companyId}";
        return await StorePlanAsync(agent, kind, companyId, payload, summary, key);
    }

    private static SupplierDto SupplierFromPlan(JsonElement p)
    {
        string? S(string n) => p.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return new SupplierDto
        {
            Id = p.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt32() : null,
            CompanyId = p.GetProperty("companyId").GetInt32(), Name = S("name")!, Address = S("address"), Phone = S("phone"), Email = S("email"),
            NTN = S("ntn"), STRN = S("strn"), CNIC = S("cnic"), Site = S("site"), RegistrationType = S("registrationType"),
            FbrProvinceCode = p.TryGetProperty("fbrProvinceCode", out var pc) && pc.ValueKind == JsonValueKind.Number ? pc.GetInt32() : null,
        };
    }

    // ── prepare_item_type ──────────────────────────────────────────────

    private async Task<object> PrepareItemTypeAsync(JsonElement args)
    {
        var agent = await RequireWriterAsync(McpScopes.ItemTypes);
        var companyId = await CompanyArg(args);
        var itemTypeId = IntArg(args, "itemTypeId");
        await Need(itemTypeId.HasValue ? "itemtypes.manage.update" : "itemtypes.manage.create");
        if (itemTypeId.HasValue) await Need("itemtypes.manage.view");
        var key = IdemKey(args);
        if (await PriorForKeyAsync(agent, key, companyId, McpScopes.ItemTypes) is { } prior) return prior;

        ItemTypeDto dto;
        if (itemTypeId.HasValue)
        {
            // Explicit company match on top of the catalog filter PinCompanyAsync applied.
            var owned = await _context.ItemTypes.AsNoTracking().AnyAsync(t => t.Id == itemTypeId && t.CompanyId == companyId && !t.IsDeleted);
            var existing = owned ? await OperationService<IItemTypeService>().GetByIdAsync(itemTypeId.Value) : null;
            if (existing == null) throw new ToolError("Resource unavailable or access denied.");
            dto = existing;
        }
        else
        {
            var name0 = OptText(args, "name", 200);
            // Without a name, a new item takes its HS code's one-line short name, as the screens do.
            if (string.IsNullOrEmpty(name0) && OptText(args, "hsCode", 20) is { Length: > 0 } code0)
                name0 = (await OperationService<IFbrService>().GetHSCodesAsync(companyId, code0))
                    .FirstOrDefault(h => h.HS_CODE == code0)?.ShortName;
            if (string.IsNullOrEmpty(name0)) throw new ToolError("name is required to create an item, unless hsCode is an FBR code (its short name is used).");
            // A new item is a favourite, the form's own default.
            dto = new ItemTypeDto { CompanyId = companyId, Name = name0, IsFavorite = true };
        }
        if (Has(args, "name") && OptText(args, "name", 200) is { Length: > 0 } nm) dto.Name = nm;
        if (OptText(args, "hsCode", 20) is { } hs)
        {
            if (hs.Length > 0 && !hs.All(c => char.IsDigit(c) || c == '.')) throw new ToolError("hsCode may contain digits and dots only, e.g. 8481.8090.");
            dto.HSCode = hs.Length == 0 ? null : hs;
        }
        if (OptText(args, "uom", 50) is { } uom) dto.UOM = uom.Length == 0 ? null : uom;
        if (OptText(args, "saleType", 100) is { } sale) dto.SaleType = sale.Length == 0 ? null : sale;

        // The service's (name, HS code) uniqueness rule, surfaced now instead of at commit.
        var hsKey = string.IsNullOrWhiteSpace(dto.HSCode) ? null : dto.HSCode.Trim();
        var clash = await _context.ItemTypes.AsNoTracking()
            .Where(t => t.CompanyId == companyId && !t.IsDeleted && t.Id != dto.Id && t.Name == dto.Name && t.HSCode == hsKey)
            .Select(t => new { t.Id, t.Name }).FirstOrDefaultAsync();
        if (clash != null) throw new ToolError($"An item named \"{clash.Name}\" with this HS code already exists in this company (id {clash.Id}).");

        var kind = itemTypeId.HasValue ? "itemtype.update" : "itemtype.create";
        var payload = new
        {
            dto.Id, companyId, dto.Name, hsCode = dto.HSCode, uom = dto.UOM, fbrUomId = dto.FbrUOMId, dto.SaleType,
            dto.FbrDescription, dto.IsFavorite,
            note = string.IsNullOrEmpty(dto.HSCode) ? "No HS code: saved as an unclassified draft item that moves no stock and cannot be filed with FBR." : "The HS code is checked against FBR's catalog when committed.",
        };
        var summary = itemTypeId.HasValue
            ? $"Update item #{dto.Id} \"{dto.Name}\" (HS {dto.HSCode ?? "none"}) in company {companyId}"
            : $"Create item \"{dto.Name}\" (HS {dto.HSCode ?? "none"}, unit {dto.UOM ?? "none"}) in company {companyId}";
        return await StorePlanAsync(agent, kind, companyId, payload, summary, key);
    }

    private static ItemTypeDto ItemTypeFromPlan(JsonElement p)
    {
        string? S(string n) => p.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return new ItemTypeDto
        {
            Id = p.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt32() : 0,
            CompanyId = p.GetProperty("companyId").GetInt32(), Name = S("name")!, HSCode = S("hsCode"), UOM = S("uom"),
            FbrUOMId = p.TryGetProperty("fbrUomId", out var u) && u.ValueKind == JsonValueKind.Number ? u.GetInt32() : null,
            SaleType = S("saleType"), FbrDescription = S("fbrDescription"),
            IsFavorite = p.TryGetProperty("isFavorite", out var f) && f.ValueKind == JsonValueKind.True,
        };
    }
}
