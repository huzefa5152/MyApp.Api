using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Write tools. Nothing here saves a business record directly: <c>prepare_*</c> validates
    /// and stores a plan, and only <c>commit_action</c> hands that exact plan to the same
    /// service the web screen uses, once, with permissions and company access checked again.
    ///
    /// Every write needs ALL of: an agent token (never a plain login token), the write scope on
    /// it, the platform opt-in <c>mcp.write.use</c> for its user, and the very permission the
    /// matching screen needs. The host's own confirmation prompt is expected on commit_action.
    /// </summary>
    public partial class McpController
    {
        private string _resultRef = "";
        private string _resultSummary = "";

        private static readonly string[] WriteToolNameList = { "prepare_client", "prepare_quote", "prepare_challan", "prepare_bill", "commit_action", "cancel_action" };
        private static bool IsWriteTool(string name) => WriteToolNameList.Contains(name, StringComparer.Ordinal);

        private static string PrepareToolFor(string kind) => kind switch
        {
            "client.create" or "client.update" => "prepare_client",
            "quote.create" => "prepare_quote",
            "challan.create" => "prepare_challan",
            "bill.create" or "bill.standalone" => "prepare_bill",
            _ => throw new ToolError("Unknown action kind.")
        };

        // Self-contained on purpose: static fields in different files of a partial class are
        // initialised in an unspecified order across builds, so nothing here may read a static
        // field declared in another file while it is being initialised.
        private static readonly object WCompanyId = new { type = "integer", minimum = 1, description = "Company id from list_companies." };
        private static readonly object PrepareAnnotations = new { readOnlyHint = false, destructiveHint = false, idempotentHint = true, openWorldHint = false };
        private static readonly object CommitAnnotations = new { readOnlyHint = false, destructiveHint = false, idempotentHint = false, openWorldHint = false };
        private static readonly object IdemKeyProp = new { type = "string", maxLength = 100, description = "Optional. A stable id for this request (an email message id, say). Repeating it returns the original plan or result instead of creating a duplicate." };

        private static readonly object PrepareClientTool = new
        {
            name = "prepare_client",
            description = "Prepare a new client, or an update when clientId is given. Nothing is saved: returns a plan to show the user. Call commit_action only after they approve.",
            inputSchema = Schema(new
            {
                companyId = WCompanyId, clientId = new { type = "integer", minimum = 1, description = "Omit to create; give to update only the fields you pass." },
                name = new { type = "string", maxLength = 200 }, address = new { type = "string", maxLength = 500 }, phone = new { type = "string", maxLength = 50 },
                email = new { type = "string", maxLength = 200 }, ntn = new { type = "string", maxLength = 50 }, strn = new { type = "string", maxLength = 50 },
                cnic = new { type = "string", maxLength = 50 }, site = new { type = "string", maxLength = 200 }, contactPerson = new { type = "string", maxLength = 300 },
                registrationType = new { type = "string", @enum = new[] { "Registered", "Unregistered" } }, fbrProvinceCode = new { type = "integer", minimum = 1 },
                idempotencyKey = IdemKeyProp,
            }, "companyId"),
            annotations = PrepareAnnotations,
        };

        private static readonly object PrepareQuoteTool = new
        {
            name = "prepare_quote",
            description = "Prepare a sales quotation (never a bill or FBR invoice). Nothing is saved: returns exact totals to show the user. Call commit_action only after they approve.",
            inputSchema = Schema(new
            {
                companyId = WCompanyId, clientId = new { type = "integer", minimum = 1 },
                date = new { type = "string", format = "date", description = "Defaults to today." }, validUntil = new { type = "string", format = "date" },
                customerEnquiryRef = new { type = "string", maxLength = 200 }, enquiryDate = new { type = "string", format = "date" },
                notes = new { type = "string", maxLength = 2000 }, contactPerson = new { type = "string", maxLength = 300 },
                gstRate = new { type = "string", description = "Percent, up to 2 decimals. Default 18." },
                items = new
                {
                    type = "array", minItems = 1, maxItems = 100,
                    items = new
                    {
                        type = "object", additionalProperties = false, required = new[] { "description", "quantity", "unit", "unitPrice" },
                        properties = new
                        {
                            description = new { type = "string", maxLength = 500 }, quantity = new { type = "string", description = "Up to 4 decimals." },
                            unit = new { type = "string", maxLength = 50 }, unitPrice = new { type = "string", description = "PKR, up to 2 decimals." },
                            itemTypeId = new { type = "integer", minimum = 1 },
                        },
                    },
                },
                idempotencyKey = IdemKeyProp,
            }, "companyId", "clientId", "items"),
            annotations = PrepareAnnotations,
        };

        private static readonly object CommitTool = new
        {
            name = "commit_action",
            description = "WRITE: execute a prepared plan exactly once, as the signed-in user. Call only after the user approved the plan you showed. Never retry an uncertain result: check with search_* first.",
            inputSchema = Schema(new { planId = new { type = "string", maxLength = 64 } }, "planId"),
            annotations = CommitAnnotations,
        };

        private static readonly object CancelTool = new
        {
            name = "cancel_action",
            description = "Discard a prepared plan that will not be committed.",
            inputSchema = Schema(new { planId = new { type = "string", maxLength = 64 } }, "planId"),
            annotations = PrepareAnnotations,
        };

        /// <summary>Read tools for everyone; write tools only when the token carries a write scope.</summary>
        private async Task<object[]> ToolCatalogueAsync()
        {
            var tools = new List<object>(ReadTools) { SearchChallansTool, GetChallanTool };
            tools.AddRange(ReportTools());
            var visible = new List<object>();
            foreach (var tool in tools)
            {
                var name = JsonSerializer.SerializeToElement(tool).GetProperty("name").GetString()!;
                if (await LegacyToolAllowedAsync(name)) visible.Add(tool);
            }
            tools = visible;
            var agent = Agent;
            if (agent is { AllowWrites: true } && await _permissions.HasPermissionAsync(CurrentUserId, "mcp.write.use"))
            {
                if (agent.HasScope(McpScopes.Clients) && await LegacyToolAllowedAsync("prepare_client")) tools.Add(PrepareClientTool);
                if (agent.HasScope(McpScopes.Quotes) && await LegacyToolAllowedAsync("prepare_quote")) tools.Add(PrepareQuoteTool);
                if (agent.HasScope(McpScopes.Challans) && await LegacyToolAllowedAsync("prepare_challan")) tools.Add(PrepareChallanTool);
                if (agent.HasScope(McpScopes.Bills) && await LegacyToolAllowedAsync("prepare_bill")) tools.Add(PrepareBillTool);
                tools.Add(CommitTool);
                tools.Add(CancelTool);
            }
            tools.AddRange(await ExpandedCatalogueAsync());
            return tools.ToArray();
        }

        // ── gating ─────────────────────────────────────────────────────────

        /// <summary>The agent token for a write, after every gate. Throws a ToolError otherwise.</summary>
        private async Task<McpAgentToken> RequireWriterAsync(string scope)
        {
            var agent = Agent ?? throw new ToolError("Writes need an agent token. A plain login token is read-only.");
            if (!agent.AllowWrites || !agent.HasScope(scope)) throw new ToolError("This agent token is not allowed to write.");
            if (!await _permissions.HasPermissionAsync(CurrentUserId, "mcp.write.use"))
                throw new ToolError("Write access is not enabled for this user.");
            return agent;
        }

        // ── argument helpers ───────────────────────────────────────────────

        private static bool Has(JsonElement args, string name) =>
            args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null;

        /// <summary>Optional text field: null when absent, trimmed and length-checked when present.</summary>
        private static string? OptText(JsonElement args, string name, int max)
        {
            if (!Has(args, name)) return null;
            args.TryGetProperty(name, out var v);
            if (v.ValueKind != JsonValueKind.String) throw new ToolError($"{name} must be text.");
            var s = v.GetString()!.Trim();
            if (s.Length > max) throw new ToolError($"{name} is too long (at most {max} characters).");
            return s;
        }

        private static string? IdemKey(JsonElement args)
        {
            var k = OptText(args, "idempotencyKey", 100);
            return string.IsNullOrEmpty(k) ? null : k;
        }

        /// <summary>A decimal given as a JSON number or a string, with a bound and a decimal-place limit.</summary>
        private static decimal Dec(JsonElement el, string what, decimal min, decimal max, int places, bool minInclusive = true)
        {
            decimal d;
            if (el.ValueKind == JsonValueKind.Number) { if (!el.TryGetDecimal(out d)) throw new ToolError($"{what} is not a valid number."); }
            else if (el.ValueKind != JsonValueKind.String || !decimal.TryParse(el.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out d))
                throw new ToolError($"{what} must be a number.");
            if (d < min || d > max || (!minInclusive && d == min)) throw new ToolError($"{what} is out of range.");
            if (decimal.Round(d, places) != d) throw new ToolError($"{what} may have at most {places} decimal places.");
            return d;
        }

        private static DateTime? OptDate(JsonElement args, string name)
        {
            var s = OptText(args, name, 10);
            if (string.IsNullOrEmpty(s)) return null;
            return DateTime.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : throw new ToolError($"{name} must be yyyy-MM-dd.");
        }

        // ── plan store ─────────────────────────────────────────────────────

        /// <summary>An earlier plan or result for the same agent and idempotency key, if any.</summary>
        private async Task<object?> PriorForKeyAsync(McpAgentToken agent, string? key, int companyId, string scope)
        {
            if (key == null) return null;
            var prior = await _context.McpPendingActions.AsNoTracking()
                .FirstOrDefaultAsync(a => a.AgentTokenId == agent.Id && a.IdempotencyKey == key);
            if (prior == null) return null;
            if (prior.UserId != CurrentUserId || prior.CompanyId != companyId || ScopeFor(prior.Kind) != scope)
                throw new ToolError("That request key belongs to a different company or action.");
            await PinCompanyAsync(prior.CompanyId);
            await RequireWriterAsync(ScopeFor(prior.Kind));
            await Need(PermissionFor(prior.Kind));
            if (!await _permissions.HasMcpToolAccessAsync(CurrentUserId, PrepareToolFor(prior.Kind)))
                throw new ToolError("Resource unavailable or access denied.");
            if (prior.CommittedAt != null)
                return new { alreadyDone = !string.IsNullOrEmpty(prior.ResultRef) && prior.ResultRef != "FAILED",
                    planId = prior.PlanId, prior.ResultRef, summary = prior.ResultSummary ?? prior.Summary,
                    status = prior.ResultRef == "FAILED" ? "failedOrIncomplete" : string.IsNullOrEmpty(prior.ResultRef) ? "executingOrUnknown" : "succeeded",
                    note = "This request was already claimed. Check its outcome; do not create a duplicate." };
            if (prior.ExpiresAt > DateTime.UtcNow)
                return PlanResponse(prior, "This request was already prepared. Reusing the same plan.");
            // Expired and never committed: the key is free again for a fresh plan.
            await _context.McpPendingActions.Where(a => a.Id == prior.Id).ExecuteDeleteAsync();
            return null;
        }

        private object PlanResponse(McpPendingAction plan, string? note = null) => new
        {
            planId = plan.PlanId, kind = plan.Kind, companyId = plan.CompanyId, summary = plan.Summary,
            details = JsonSerializer.Deserialize<JsonElement>(plan.Payload),
            expiresInSeconds = Math.Max(0, (int)(plan.ExpiresAt - DateTime.UtcNow).TotalSeconds),
            saved = false, note,
            instruction = "Nothing has been saved. Show this plan to the user and obtain approval, then call commit_action with the planId.",
        };

        private async Task<object> StorePlanAsync(McpAgentToken agent, string kind, int companyId, object payload, string summary, string? key)
        {
            await _context.McpPendingActions.Where(a => a.ExpiresAt < DateTime.UtcNow.AddHours(-1) && a.CommittedAt == null).ExecuteDeleteAsync();
            var open = await _context.McpPendingActions.CountAsync(a => a.AgentTokenId == agent.Id && a.CommittedAt == null && a.ExpiresAt > DateTime.UtcNow);
            if (open >= 25) throw new ToolError("Too many plans are waiting. Commit or cancel some first.");
            var now = DateTime.UtcNow;
            var plan = new McpPendingAction
            {
                PlanId = "plan_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).Replace('+', '-').Replace('/', '_').TrimEnd('='),
                AgentTokenId = agent.Id, UserId = CurrentUserId, CompanyId = companyId, Kind = kind,
                Payload = JsonSerializer.Serialize(payload, Json), Summary = Trunc(summary, 1000), IdempotencyKey = key,
                CreatedAt = now, ExpiresAt = now.AddMinutes(McpPendingAction.LifetimeMinutes),
            };
            _context.McpPendingActions.Add(plan);
            await _context.SaveChangesAsync();
            _resultSummary = plan.Summary;
            return PlanResponse(plan);
        }

        // ── prepare_client ─────────────────────────────────────────────────

        private async Task<object> PrepareClientAsync(JsonElement args)
        {
            var agent = await RequireWriterAsync(McpScopes.Clients);
            var companyId = await CompanyArg(args);
            var clientId = IntArg(args, "clientId");
            await Need(clientId.HasValue ? "clients.manage.update" : "clients.manage.create");
            var key = IdemKey(args);
            if (await PriorForKeyAsync(agent, key, companyId, McpScopes.Clients) is { } prior) return prior;

            ClientDto dto;
            if (clientId.HasValue)
            {
                var existing = await _clients.GetByIdAsync(clientId.Value);
                if (existing == null || existing.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
                dto = existing;
            }
            else
            {
                var name0 = OptText(args, "name", 200);
                if (string.IsNullOrEmpty(name0)) throw new ToolError("name is required to create a client.");
                dto = new ClientDto { CompanyId = companyId, Name = name0 };
            }
            if (Has(args, "name") && OptText(args, "name", 200) is { Length: > 0 } nm) dto.Name = nm;
            if (OptText(args, "address", 500) is { } ad) dto.Address = ad.Length == 0 ? null : ad;
            if (OptText(args, "phone", 50) is { } ph) dto.Phone = ph.Length == 0 ? null : ph;
            if (OptText(args, "email", 200) is { } em) dto.Email = em.Length == 0 ? null : em;
            if (OptText(args, "ntn", 50) is { } nt) dto.NTN = nt.Length == 0 ? null : nt;
            if (OptText(args, "strn", 50) is { } st) dto.STRN = st.Length == 0 ? null : st;
            if (OptText(args, "cnic", 50) is { } cn) dto.CNIC = cn.Length == 0 ? null : cn;
            if (OptText(args, "site", 200) is { } si) dto.Site = si.Length == 0 ? null : si;
            if (OptText(args, "contactPerson", 300) is { } cp) dto.ContactPerson = cp.Length == 0 ? null : cp;
            if (OptText(args, "registrationType", 20) is { } rt)
            {
                if (rt is not ("Registered" or "Unregistered")) throw new ToolError("registrationType must be Registered or Unregistered.");
                dto.RegistrationType = rt;
            }
            if (Has(args, "fbrProvinceCode"))
                dto.FbrProvinceCode = IntArg(args, "fbrProvinceCode") is { } pc and > 0 ? pc : throw new ToolError("fbrProvinceCode must be a positive integer.");
            if (dto.Email != null && !dto.Email.Contains('@')) throw new ToolError("email does not look like an email address.");

            // The same name rule the service enforces, surfaced now instead of at commit.
            var siblings = await _clients.GetByCompanyAsync(companyId);
            var clash = siblings.FirstOrDefault(c => c.Id != dto.Id && string.Equals(c.Name, dto.Name, StringComparison.OrdinalIgnoreCase));
            if (clash != null) throw new ToolError($"A client named \"{clash.Name}\" already exists in this company (id {clash.Id}).");

            var kind = clientId.HasValue ? "client.update" : "client.create";
            var payload = new
            {
                dto.Id, dto.CompanyId, dto.Name, dto.Address, dto.Phone, dto.Email, dto.NTN, dto.STRN, dto.CNIC, dto.Site,
                dto.ContactPerson, dto.RegistrationType, dto.FbrProvinceCode,
            };
            var summary = clientId.HasValue
                ? $"Update client #{dto.Id} \"{dto.Name}\" in company {companyId}"
                : $"Create client \"{dto.Name}\" in company {companyId}";
            return await StorePlanAsync(agent, kind, companyId, payload, summary, key);
        }

        // ── prepare_quote ──────────────────────────────────────────────────

        private async Task<object> PrepareQuoteAsync(JsonElement args)
        {
            var agent = await RequireWriterAsync(McpScopes.Quotes);
            var companyId = await CompanyArg(args);
            await Need("salesquotes.manage.create");
            var key = IdemKey(args);
            if (await PriorForKeyAsync(agent, key, companyId, McpScopes.Quotes) is { } prior) return prior;

            var clientId = IntArg(args, "clientId") ?? throw new ToolError("clientId is required.");
            var client = clientId > 0 ? await _clients.GetByIdAsync(clientId) : null;
            if (client == null || client.CompanyId != companyId) throw new ToolError("The client does not belong to this company.");

            var gst = Has(args, "gstRate") ? Dec(args.GetProperty("gstRate"), "gstRate", 0, 100, 2) : 18m;
            if (!args.TryGetProperty("items", out var itemsEl) || itemsEl.ValueKind != JsonValueKind.Array) throw new ToolError("items is required.");
            var count = itemsEl.GetArrayLength();
            if (count is < 1 or > 100) throw new ToolError("Use between 1 and 100 items.");

            var lines = new List<SalesQuoteItemDto>();
            foreach (var it in itemsEl.EnumerateArray())
            {
                if (it.ValueKind != JsonValueKind.Object) throw new ToolError("Each item must be an object.");
                var desc = OptText(it, "description", 500);
                var unit = OptText(it, "unit", 50);
                if (string.IsNullOrEmpty(desc)) throw new ToolError("Item descriptions cannot be empty.");
                if (string.IsNullOrEmpty(unit)) throw new ToolError("Item units cannot be empty.");
                if (!it.TryGetProperty("quantity", out var q) || !it.TryGetProperty("unitPrice", out var p)) throw new ToolError("Each item needs quantity and unitPrice.");
                var qty = Dec(q, "quantity", 0m, 999_999_999m, 4, minInclusive: false);
                var price = Dec(p, "unitPrice", 0m, 999_999_999m, 2);
                int? itemTypeId = null;
                if (Has(it, "itemTypeId"))
                {
                    itemTypeId = IntArg(it, "itemTypeId") is { } t and > 0 ? t : throw new ToolError("itemTypeId must be a positive integer.");
                    var ok = await _context.ItemTypes.AsNoTracking().AnyAsync(x => x.Id == itemTypeId && x.CompanyId == companyId && !x.IsDeleted);
                    if (!ok) throw new ToolError("An item type is outside this company.");
                }
                lines.Add(new SalesQuoteItemDto { Description = desc, Unit = unit, Quantity = qty, UnitPrice = price, ItemTypeId = itemTypeId, LineTotal = Math.Round(qty * price, 2) });
            }
            var subtotal = lines.Sum(l => l.LineTotal);
            var gstAmount = Math.Round(subtotal * gst / 100m, 2);
            var date = OptDate(args, "date") ?? DateTime.UtcNow.Date;

            var payload = new
            {
                companyId, clientId, clientName = client.Name, date = date.ToString("yyyy-MM-dd"),
                validUntil = OptDate(args, "validUntil")?.ToString("yyyy-MM-dd"), customerEnquiryRef = OptText(args, "customerEnquiryRef", 200),
                enquiryDate = OptDate(args, "enquiryDate")?.ToString("yyyy-MM-dd"), notes = OptText(args, "notes", 2000),
                contactPerson = OptText(args, "contactPerson", 300), gstRate = gst,
                items = lines.Select(l => new { l.Description, l.Quantity, l.Unit, l.UnitPrice, l.ItemTypeId, l.LineTotal }),
                subtotal, gstAmount, grandTotal = subtotal + gstAmount, currency = "PKR",
            };
            var summary = $"Create a sales quotation for \"{client.Name}\" in company {companyId}: {lines.Count} line(s), subtotal {subtotal:0.00}, GST {gst}% = {gstAmount:0.00}, total {subtotal + gstAmount:0.00} PKR";
            return await StorePlanAsync(agent, "quote.create", companyId, payload, summary, key);
        }

        // ── commit / cancel ────────────────────────────────────────────────

        private static string ScopeFor(string kind) => kind switch
        {
            "client.create" or "client.update" => McpScopes.Clients,
            "challan.create" => McpScopes.Challans,
            "bill.create" or "bill.standalone" => McpScopes.Bills,
            "quote.create" => McpScopes.Quotes,
            _ => throw new ToolError("Unknown plan type.")
        };

        private static string PermissionFor(string kind) => kind switch
        {
            "client.create" => "clients.manage.create",
            "client.update" => "clients.manage.update",
            "challan.create" => "challans.manage.create",
            "bill.create" => "bills.manage.create",
            "bill.standalone" => "bills.manage.create.standalone",
            "quote.create" => "salesquotes.manage.create",
            _ => throw new ToolError("Unknown plan type.")
        };

        private async Task<McpPendingAction> OwnPlanAsync(string? planId)
        {
            var agent = Agent ?? throw new ToolError("Writes need an agent token. A plain login token is read-only.");
            var id = (planId ?? "").Trim();
            var plan = id.Length is > 0 and <= 64 ? await _context.McpPendingActions.AsNoTracking().FirstOrDefaultAsync(a => a.PlanId == id) : null;
            // Someone else's plan id answers exactly like a missing one.
            if (plan == null || plan.AgentTokenId != agent.Id || plan.UserId != CurrentUserId)
                throw new ToolError("That plan was not found. It may have expired.");
            return plan;
        }

        private async Task<object> CancelActionAsync(JsonElement args)
        {
            var plan = await OwnPlanAsync(OptText(args, "planId", 64));
            await PinCompanyAsync(plan.CompanyId);
            var removed = await _context.McpPendingActions.Where(a => a.Id == plan.Id && a.CommittedAt == null).ExecuteDeleteAsync();
            if (removed == 0) throw new ToolError("That plan was already committed and cannot be cancelled.");
            _resultSummary = $"Cancelled: {plan.Summary}";
            return new { cancelled = true, planId = plan.PlanId };
        }

        private async Task<object> CommitActionAsync(JsonElement args)
        {
            var plan = await OwnPlanAsync(OptText(args, "planId", 64));
            if (!await _permissions.HasMcpToolAccessAsync(CurrentUserId, PrepareToolFor(plan.Kind)))
                throw new ToolError("Resource unavailable or access denied.");
            // Every gate is checked again NOW: the world may have changed since the plan was made.
            var agent = await RequireWriterAsync(ScopeFor(plan.Kind));
            if (plan.UserId != CurrentUserId) throw new ToolError("That plan was not found. It may have expired.");
            if (plan.CommittedAt != null) throw new ToolError("That plan was already committed.");
            if (plan.ExpiresAt <= DateTime.UtcNow) throw new ToolError("That plan has expired. Prepare it again.");
            await PinCompanyAsync(plan.CompanyId);
            await Need(PermissionFor(plan.Kind));
            await EnforceHourlyCapAsync(agent, plan.Kind);

            // Claim it atomically: of two simultaneous commits only one proceeds, so a double
            // submit can never create a second document. At most once; never retried.
            var now = DateTime.UtcNow;
            var claimed = await _context.McpPendingActions.Where(a => a.Id == plan.Id && a.CommittedAt == null && a.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.CommittedAt, now));
            if (claimed == 0) throw new ToolError("That plan was already committed or has expired.");

            string resultRef, resultSummary;
            try
            {
                var p = JsonSerializer.Deserialize<JsonElement>(plan.Payload);
                switch (plan.Kind)
                {
                    case "client.create":
                    {
                        var created = await _clients.CreateAsync(ClientFromPlan(p));
                        (resultRef, resultSummary) = ($"Client:{created.Id}", $"Created client #{created.Id} \"{created.Name}\"");
                        break;
                    }
                    case "client.update":
                    {
                        var updated = await _clients.UpdateAsync(ClientFromPlan(p));
                        (resultRef, resultSummary) = ($"Client:{updated.Id}", $"Updated client #{updated.Id} \"{updated.Name}\"");
                        break;
                    }
                    case "quote.create":
                    {
                        var created = await _quotes.CreateAsync(plan.CompanyId, QuoteFromPlan(p));
                        (resultRef, resultSummary) = ($"SalesQuote:{created.Id}",
                            $"Created quotation #{created.QuoteNumber} (id {created.Id}) for \"{created.ClientName}\", total {created.GrandTotal:0.00} PKR");
                        break;
                    }
                    case "challan.create":
                    {
                        var created = await _challans.CreateDeliveryChallanAsync(plan.CompanyId, ChallanFromPlan(p, plan.CompanyId));
                        (resultRef, resultSummary) = ($"DeliveryChallan:{created.Id}",
                            $"Created challan #{created.ChallanNumber} (id {created.Id}) for \"{created.ClientName}\", status {created.Status}");
                        break;
                    }
                    case "bill.create":
                    {
                        var created = await _invoices.CreateAsync(BillFromChallansPlan(p, plan.CompanyId));
                        (resultRef, resultSummary) = ($"Invoice:{created.Id}",
                            $"Created bill #{created.InvoiceNumber} (id {created.Id}) for \"{created.ClientName}\", total {created.GrandTotal:0.00} PKR. Not submitted to FBR");
                        break;
                    }
                    case "bill.standalone":
                    {
                        var created = await _invoices.CreateStandaloneAsync(StandaloneBillFromPlan(p, plan.CompanyId));
                        (resultRef, resultSummary) = ($"Invoice:{created.Id}",
                            $"Created bill #{created.InvoiceNumber} (id {created.Id}) for \"{created.ClientName}\", total {created.GrandTotal:0.00} PKR. Not submitted to FBR");
                        break;
                    }
                    default: throw new ToolError("Unknown plan type.");
                }
            }
            catch (Exception ex) when (ex is InvalidOperationException or KeyNotFoundException)
            {
                // Service rules are operator-facing messages (name clash, unknown client...).
                await _context.McpPendingActions.Where(a => a.Id == plan.Id).ExecuteUpdateAsync(s => s.SetProperty(a => a.ResultRef, "FAILED").SetProperty(a => a.ResultSummary, "The action was refused or may be incomplete. Check the affected records."));
                _resultRef = "FAILED";
                _logger.LogWarning(ex, "MCP commit {Kind} was refused for user {UserId}", plan.Kind, CurrentUserId);
                throw new ToolError("The action was refused or may be incomplete. Check get_action_status and the affected records before preparing another action.");
            }
            catch (Exception ex) when (ex is not ToolError)
            {
                _logger.LogError(ex, "MCP commit {Kind} failed for user {UserId}", plan.Kind, CurrentUserId);
                await _context.McpPendingActions.Where(a => a.Id == plan.Id).ExecuteUpdateAsync(s => s.SetProperty(a => a.ResultRef, "FAILED").SetProperty(a => a.ResultSummary, "The write failed."));
                _resultRef = "FAILED";
                throw new ToolError("The write failed and may be incomplete. Check with search_* before preparing it again.");
            }

            await _context.McpPendingActions.Where(a => a.Id == plan.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.ResultRef, resultRef).SetProperty(a => a.ResultSummary, Trunc(resultSummary, 300)));
            _resultRef = resultRef;
            _resultSummary = resultSummary;
            _logger.LogInformation("MCP write {Kind} committed by user {UserId} via token {TokenId}: {Ref}", plan.Kind, CurrentUserId, agent.Id, resultRef);
            return new { committed = true, resultRef, summary = resultSummary };
        }

        private static ClientDto ClientFromPlan(JsonElement p)
        {
            string? S(string n) => p.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            return new ClientDto
            {
                Id = p.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt32() : null,
                CompanyId = p.GetProperty("companyId").GetInt32(), Name = S("name")!, Address = S("address"), Phone = S("phone"), Email = S("email"),
                NTN = S("ntn"), STRN = S("strn"), CNIC = S("cnic"), Site = S("site"), ContactPerson = S("contactPerson"), RegistrationType = S("registrationType"),
                FbrProvinceCode = p.TryGetProperty("fbrProvinceCode", out var pc) && pc.ValueKind == JsonValueKind.Number ? pc.GetInt32() : null,
            };
        }

        private static SalesQuoteDto QuoteFromPlan(JsonElement p)
        {
            string? S(string n) => p.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            DateTime? D(string n) => S(n) is { } s ? DateTime.ParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture) : null;
            return new SalesQuoteDto
            {
                ClientId = p.GetProperty("clientId").GetInt32(), Date = D("date") ?? DateTime.UtcNow.Date, ValidUntil = D("validUntil"),
                CustomerEnquiryRef = S("customerEnquiryRef"), EnquiryDate = D("enquiryDate"), Notes = S("notes"), ContactPerson = S("contactPerson"),
                GSTRate = p.GetProperty("gstRate").GetDecimal(),
                Items = p.GetProperty("items").EnumerateArray().Select(i => new SalesQuoteItemDto
                {
                    Description = i.GetProperty("description").GetString()!, Unit = i.GetProperty("unit").GetString()!,
                    Quantity = i.GetProperty("quantity").GetDecimal(), UnitPrice = i.GetProperty("unitPrice").GetDecimal(),
                    ItemTypeId = i.TryGetProperty("itemTypeId", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt32() : null,
                }).ToList(),
            };
        }
    }
}
