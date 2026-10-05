using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Delivery challans and bills. Challans are found with two read tools; both documents
    /// are created through the usual prepare / approve / commit cycle (see the Writes partial)
    /// by the same services the screens use, so numbering, stock and FBR-readiness rules are
    /// exactly the screens' own.
    ///
    /// A bill takes the next number of the company's legal invoice sequence and moves stock,
    /// so beyond every other gate there is an hourly ceiling on commits per token: a runaway
    /// agent cannot burn through numbers. FBR submission, voiding and deleting stay manual.
    /// </summary>
    public partial class McpController
    {
        private const int BillsPerHour = 10;
        private const int ChallansPerHour = 30;
        private static readonly string[] ChallanStatuses = { "Pending", "Imported", "No PO", "Invoiced", "Cancelled", "Setup Required" };
        private static readonly string[] PaymentModes = { "Cash", "Credit", "Bank Transfer", "Cheque", "Online" };

        // Self-contained statics: see the note in the Writes partial about initialisation order.
        private static readonly object DCompanyId = new { type = "integer", minimum = 1, description = "Company id from list_companies." };
        private static readonly object DReadAnnotations = new { readOnlyHint = true, destructiveHint = false, idempotentHint = true, openWorldHint = false };
        private static readonly object DPrepareAnnotations = new { readOnlyHint = false, destructiveHint = false, idempotentHint = true, openWorldHint = false };
        private static readonly object DIdemKey = new { type = "string", maxLength = 100, description = "Optional. A stable id for this request (an email message id, say). Repeating it returns the original plan or result instead of creating a duplicate." };

        private static readonly object SearchChallansTool = new
        {
            name = "search_challans",
            description = "Search a company's delivery challans. Unbilled Pending, Imported, No PO and Setup Required challans can be billed without a PO.",
            inputSchema = Schema(new
            {
                companyId = DCompanyId, search = new { type = "string", maxLength = 200 }, clientId = new { type = "integer", minimum = 1 },
                status = new { type = "string", @enum = ChallanStatuses }, dateFrom = new { type = "string", format = "date" }, dateTo = new { type = "string", format = "date" },
                page = new { type = "integer", minimum = 1, @default = 1 }, pageSize = new { type = "integer", minimum = 1, maximum = 100, @default = 25 },
            }, "companyId"),
            annotations = DReadAnnotations,
        };

        private static readonly object GetChallanTool = new
        {
            name = "get_challan",
            description = "Read one challan with its lines. Each line's id is the deliveryItemId that prepare_bill needs.",
            inputSchema = Schema(new { companyId = DCompanyId, challanId = new { type = "integer", minimum = 1 } }, "companyId", "challanId"),
            annotations = DReadAnnotations,
        };

        private static readonly object PrepareChallanTool = new
        {
            name = "prepare_challan",
            description = "Prepare a delivery challan (a delivery note, no prices). Nothing is saved: returns a plan to show the user. Call commit_action only after they approve.",
            inputSchema = Schema(new
            {
                companyId = DCompanyId, clientId = new { type = "integer", minimum = 1 }, deliveryDate = new { type = "string", format = "date" },
                poNumber = new { type = "string", maxLength = 100, description = "PO number is optional. Challans without a PO can be billed normally." },
                poDate = new { type = "string", format = "date" }, indentNo = new { type = "string", maxLength = 100 },
                site = new { type = "string", maxLength = 300 }, notes = new { type = "string", maxLength = 2000 },
                items = new
                {
                    type = "array", minItems = 1, maxItems = 100,
                    items = new
                    {
                        type = "object", additionalProperties = false, required = new[] { "description", "quantity", "unit" },
                        properties = new
                        {
                            description = new { type = "string", maxLength = 500 }, quantity = new { type = "string", description = "Up to 4 decimals; whole numbers only for integer-only units." },
                            unit = new { type = "string", maxLength = 50 }, itemTypeId = new { type = "integer", minimum = 1 },
                        },
                    },
                },
                idempotencyKey = DIdemKey,
            }, "companyId", "clientId", "deliveryDate", "items"),
            annotations = DPrepareAnnotations,
        };

        private static readonly object PrepareBillTool = new
        {
            name = "prepare_bill",
            description = "Prepare a sales bill (invoice). With challanIds it bills those challans (give unitPrice for EVERY challan line); without, it is a standalone bill from items. Nothing is saved and no number is used until commit_action. It takes the next number of the legal invoice sequence, so only commit after the user approved. FBR submission is never done here.",
            inputSchema = Schema(new
            {
                companyId = DCompanyId, clientId = new { type = "integer", minimum = 1 }, date = new { type = "string", format = "date", description = "Defaults to today (Pakistan time); never in the future." },
                gstRate = new { type = "string", description = "Percent, up to 2 decimals. Default 18." },
                freightCharges = new { type = "string", description = "Optional non-negative PKR transport / cartage / freight charge, up to 2 decimals. Added only to the commercial bill; sales tax remains unchanged." },
                paymentTerms = new { type = "string", maxLength = 200 }, paymentMode = new { type = "string", @enum = PaymentModes },
                poNumber = new { type = "string", maxLength = 100 }, poDate = new { type = "string", format = "date" }, notes = new { type = "string", maxLength = 2000 },
                challanIds = new { type = "array", minItems = 1, maxItems = 20, items = new { type = "integer", minimum = 1 }, description = "Bill these challans. Omit for a standalone bill." },
                prices = new
                {
                    type = "array", maxItems = 500, description = "With challanIds: one entry per challan line (deliveryItemId from get_challan).",
                    items = new
                    {
                        type = "object", additionalProperties = false, required = new[] { "deliveryItemId", "unitPrice" },
                        properties = new
                        {
                            deliveryItemId = new { type = "integer", minimum = 1 }, unitPrice = new { type = "string", description = "PKR, greater than 0, up to 4 decimals." },
                            description = new { type = "string", maxLength = 500 }, itemTypeId = new { type = "integer", minimum = 1 },
                        },
                    },
                },
                items = new
                {
                    type = "array", maxItems = 100, description = "Standalone bill only: the lines.",
                    items = new
                    {
                        type = "object", additionalProperties = false, required = new[] { "description", "quantity", "unitPrice" },
                        properties = new
                        {
                            description = new { type = "string", maxLength = 500 }, quantity = new { type = "string", description = "Up to 4 decimals." },
                            uom = new { type = "string", maxLength = 50 }, unitPrice = new { type = "string", description = "PKR, greater than 0, up to 4 decimals." },
                            itemTypeId = new { type = "integer", minimum = 1 },
                        },
                    },
                },
                idempotencyKey = DIdemKey,
            }, "companyId", "clientId"),
            annotations = DPrepareAnnotations,
        };

        // ── reads ──────────────────────────────────────────────────────────

        // GET /api/deliverychallans/company/{id}/paged: challans.list.view.
        private async Task<object> SearchChallansAsync(JsonElement args)
        {
            await Need("challans.list.view");
            var companyId = await CompanyArg(args);
            var status = StrArg(args, "status", 20);
            if (status != "" && !ChallanStatuses.Contains(status)) throw new ToolError("status must be one of: " + string.Join(", ", ChallanStatuses) + ".");
            var size = PaginationHelper.Clamp(Size(args, "pageSize"), 25);
            var page = PaginationHelper.ClampPage(IntArg(args, "page") ?? 1);
            var r = await _challans.GetPagedByCompanyAsync(companyId, page, size, StrArg(args, "search"), status == "" ? null : status,
                IntArg(args, "clientId"), DateArg(args, "dateFrom"), DateArg(args, "dateTo"));
            return new
            {
                items = r.Items.Where(c => c.CompanyId == companyId).Select(c => new
                {
                    c.Id, c.CompanyId, c.ChallanNumber, c.ClientId, c.ClientName, c.PoNumber, deliveryDate = c.DeliveryDate?.ToString("yyyy-MM-dd"),
                    c.Status, c.InvoiceId, billable = ChallanBillingRules.IsBillable(c.Status, c.InvoiceId),
                }),
                totalCount = r.TotalCount, page = r.Page, pageSize = r.PageSize, totalPages = r.TotalPages,
            };
        }

        // GET /api/deliverychallans/{id}: challans.list.view; cost and supplier fields are never returned.
        private async Task<object> GetChallanAsync(JsonElement args)
        {
            await Need("challans.list.view");
            var companyId = await CompanyArg(args);
            var id = IntArg(args, "challanId") ?? throw new ToolError("challanId is required.");
            var c = id > 0 ? await _challans.GetByIdAsync(id) : null;
            if (c == null || c.CompanyId != companyId || !await _access.HasAccessAsync(CurrentUserId, c.CompanyId))
                throw new ToolError("Resource unavailable or access denied.");
            return new
            {
                c.Id, c.CompanyId, c.ChallanNumber, c.ClientId, c.ClientName, c.PoNumber, poDate = c.PoDate?.ToString("yyyy-MM-dd"),
                deliveryDate = c.DeliveryDate?.ToString("yyyy-MM-dd"), c.IndentNo, c.Site, c.Notes, c.Status, c.InvoiceId,
                billable = ChallanBillingRules.IsBillable(c.Status, c.InvoiceId),
                items = c.Items.Select(i => new { deliveryItemId = i.Id, i.Description, i.Quantity, i.Unit, i.ItemTypeId, i.ItemTypeName }),
            };
        }

        // ── shared parsing ─────────────────────────────────────────────────

        private async Task<ClientDto> ClientInCompanyAsync(JsonElement args, int companyId)
        {
            var clientId = IntArg(args, "clientId") ?? throw new ToolError("clientId is required.");
            var client = clientId > 0 ? await _clients.GetByIdAsync(clientId) : null;
            if (client == null || client.CompanyId != companyId) throw new ToolError("The client does not belong to this company.");
            return client;
        }

        private async Task<int?> ItemTypeInCompanyAsync(JsonElement el, int companyId)
        {
            if (!Has(el, "itemTypeId")) return null;
            var id = IntArg(el, "itemTypeId") is { } t and > 0 ? t : throw new ToolError("itemTypeId must be a positive integer.");
            var ok = await _context.ItemTypes.AsNoTracking().AnyAsync(x => x.Id == id && x.CompanyId == companyId && !x.IsDeleted);
            if (!ok) throw new ToolError("An item type is outside this company.");
            return id;
        }

        /// <summary>The service's rule, surfaced early: a fractional quantity needs a unit that allows decimals.</summary>
        private async Task CheckDecimalUnitsAsync(IEnumerable<(string Unit, decimal Quantity)> lines)
        {
            var fractional = lines.Where(l => l.Quantity != Math.Truncate(l.Quantity)).ToList();
            if (fractional.Count == 0) return;
            var names = fractional.Select(l => l.Unit).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var config = await _context.Units.AsNoTracking().Where(u => names.Contains(u.Name))
                .Select(u => new { u.Name, u.AllowsDecimalQuantity }).ToListAsync();
            var allows = config.GroupBy(u => u.Name, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Any(u => u.AllowsDecimalQuantity), StringComparer.OrdinalIgnoreCase);
            foreach (var l in fractional)
                if (allows.TryGetValue(l.Unit, out var ok) && !ok)
                    throw new ToolError($"The unit \"{l.Unit}\" only allows whole quantities (got {l.Quantity}).");
        }

        private static DateTime PkToday() => PakistanClock.Today;

        // ── prepare_challan ────────────────────────────────────────────────

        private async Task<object> PrepareChallanAsync(JsonElement args)
        {
            var agent = await RequireWriterAsync(McpScopes.Challans);
            var companyId = await CompanyArg(args);
            await Need("challans.manage.create");
            var key = IdemKey(args);
            if (await PriorForKeyAsync(agent, key, companyId, McpScopes.Challans) is { } prior) return prior;

            var client = await ClientInCompanyAsync(args, companyId);
            var delivery = OptDate(args, "deliveryDate") ?? throw new ToolError("deliveryDate is required.");
            var po = OptText(args, "poNumber", 100) ?? "";
            var poDate = OptDate(args, "poDate");
            if (!args.TryGetProperty("items", out var itemsEl) || itemsEl.ValueKind != JsonValueKind.Array) throw new ToolError("items is required.");
            if (itemsEl.GetArrayLength() is < 1 or > 100) throw new ToolError("Use between 1 and 100 items.");

            var lines = new List<(string Description, decimal Quantity, string Unit, int? ItemTypeId)>();
            foreach (var it in itemsEl.EnumerateArray())
            {
                if (it.ValueKind != JsonValueKind.Object) throw new ToolError("Each item must be an object.");
                var desc = OptText(it, "description", 500);
                var unit = OptText(it, "unit", 50);
                if (string.IsNullOrEmpty(desc)) throw new ToolError("Item descriptions cannot be empty.");
                if (string.IsNullOrEmpty(unit)) throw new ToolError("Item units cannot be empty.");
                if (!it.TryGetProperty("quantity", out var q)) throw new ToolError("Each item needs a quantity.");
                lines.Add((desc, Dec(q, "quantity", 0m, 999_999_999m, 4, minInclusive: false), unit, await ItemTypeInCompanyAsync(it, companyId)));
            }
            await CheckDecimalUnitsAsync(lines.Select(l => (l.Unit, l.Quantity)));

            var hasPo = po.Length > 0;
            var payload = new
            {
                companyId, clientId = client.Id, clientName = client.Name, deliveryDate = delivery.ToString("yyyy-MM-dd"), poNumber = po,
                poDate = hasPo ? poDate?.ToString("yyyy-MM-dd") : null, indentNo = OptText(args, "indentNo", 100), site = OptText(args, "site", 300),
                notes = OptText(args, "notes", 2000),
                items = lines.Select(l => new { l.Description, l.Quantity, l.Unit, l.ItemTypeId }),
                expectedStatus = hasPo
                    ? "Pending (billable), or Setup Required if the client's FBR details are incomplete"
                    : "No PO: optional PO details can be assigned when billing",
            };
            var summary = $"Create a delivery challan for \"{client.Name}\" in company {companyId}: {lines.Count} line(s), delivery {delivery:yyyy-MM-dd}, "
                + (hasPo ? $"PO {po}" : "no PO number");
            return await StorePlanAsync(agent, "challan.create", companyId, payload, summary, key);
        }

        // ── prepare_bill ───────────────────────────────────────────────────

        private static decimal RoundAway(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

        private async Task<object> PrepareBillAsync(JsonElement args)
        {
            var agent = await RequireWriterAsync(McpScopes.Bills);
            var companyId = await CompanyArg(args);
            var fromChallans = Has(args, "challanIds");
            await Need(fromChallans ? "bills.manage.create" : "bills.manage.create.standalone");
            var key = IdemKey(args);
            if (await PriorForKeyAsync(agent, key, companyId, McpScopes.Bills) is { } prior) return prior;

            var company = await _companies.GetByIdAsync(companyId) ?? throw new ToolError("Resource unavailable or access denied.");
            if (company.StartingInvoiceNumber == 0) throw new ToolError("The starting invoice number has not been set for this company.");
            var client = await ClientInCompanyAsync(args, companyId);
            var date = OptDate(args, "date") ?? PkToday();
            if (date.Date > PkToday()) throw new ToolError("A bill cannot be dated in the future (FBR rule 0043).");
            var gst = Has(args, "gstRate") ? Dec(args.GetProperty("gstRate"), "gstRate", 0, 100, 2) : 18m;
            var freight = Has(args, "freightCharges")
                ? CommercialTotalCalculator.Validate(Dec(args.GetProperty("freightCharges"), "freightCharges", 0m, 9999999999999999.99m, 2))
                : 0m;
            var mode = OptText(args, "paymentMode", 20);
            if (!string.IsNullOrEmpty(mode) && !PaymentModes.Contains(mode)) throw new ToolError("paymentMode must be one of: " + string.Join(", ", PaymentModes) + ".");

            var lines = new List<(int? DeliveryItemId, string Description, decimal Quantity, string Unit, decimal UnitPrice, int? ItemTypeId)>();
            List<int>? challanIds = null;
            if (fromChallans)
            {
                if (Has(args, "items")) throw new ToolError("Give prices for the challan lines, not items. A standalone bill omits challanIds.");
                if (args.GetProperty("challanIds").ValueKind != JsonValueKind.Array) throw new ToolError("challanIds must be a list.");
                challanIds = args.GetProperty("challanIds").EnumerateArray()
                    .Select(e => e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var n) && n > 0 ? n : throw new ToolError("challanIds must be positive integers."))
                    .Distinct().ToList();
                if (challanIds.Count is < 1 or > 20) throw new ToolError("Choose between 1 and 20 challans.");

                var deliveryItems = new Dictionary<int, DeliveryItemDto>();
                foreach (var cid in challanIds)
                {
                    var ch = await _challans.GetByIdAsync(cid);
                    if (ch == null || ch.CompanyId != companyId) throw new ToolError($"Challan {cid} was not found in this company.");
                    if (ch.ClientId != client.Id) throw new ToolError($"Challan {ch.ChallanNumber} belongs to a different client than the bill.");
                    if (!ChallanBillingRules.IsBillable(ch.Status, ch.InvoiceId))
                        throw new ToolError($"Challan {ch.ChallanNumber} cannot be billed (status {ch.Status}).");
                    foreach (var i in ch.Items) deliveryItems[i.Id] = i;
                }
                if (!Has(args, "prices") || args.GetProperty("prices").ValueKind != JsonValueKind.Array) throw new ToolError("prices is required: one entry per challan line.");
                var seen = new HashSet<int>();
                foreach (var p in args.GetProperty("prices").EnumerateArray())
                {
                    var did = IntArg(p, "deliveryItemId") ?? throw new ToolError("Each price needs a deliveryItemId.");
                    if (!deliveryItems.TryGetValue(did, out var di)) throw new ToolError($"Line {did} is not on the chosen challans.");
                    if (!seen.Add(did)) throw new ToolError($"Line {did} is priced twice.");
                    if (!p.TryGetProperty("unitPrice", out var up)) throw new ToolError("Each price needs a unitPrice.");
                    var price = Dec(up, "unitPrice", 0m, 999_999_999m, 4, minInclusive: false);
                    var desc = OptText(p, "description", 500);
                    lines.Add((did, string.IsNullOrEmpty(desc) ? di.Description : desc, di.Quantity, di.Unit, price, await ItemTypeInCompanyAsync(p, companyId) ?? di.ItemTypeId));
                }
                var missing = deliveryItems.Keys.Except(seen).ToList();
                if (missing.Count > 0) throw new ToolError("Every challan line needs a price. Missing: " + string.Join(", ", missing.Take(10)) + ".");
            }
            else
            {
                if (Has(args, "prices")) throw new ToolError("prices applies to challan lines. For a standalone bill give items.");
                if (!args.TryGetProperty("items", out var itemsEl) || itemsEl.ValueKind != JsonValueKind.Array) throw new ToolError("items is required for a standalone bill.");
                if (itemsEl.GetArrayLength() is < 1 or > 100) throw new ToolError("Use between 1 and 100 items.");
                foreach (var it in itemsEl.EnumerateArray())
                {
                    if (it.ValueKind != JsonValueKind.Object) throw new ToolError("Each item must be an object.");
                    var desc = OptText(it, "description", 500);
                    if (string.IsNullOrEmpty(desc)) throw new ToolError("Item descriptions cannot be empty.");
                    if (!it.TryGetProperty("quantity", out var q) || !it.TryGetProperty("unitPrice", out var up)) throw new ToolError("Each item needs quantity and unitPrice.");
                    var qty = Dec(q, "quantity", 0m, 999_999_999m, 4, minInclusive: false);
                    var price = Dec(up, "unitPrice", 0m, 999_999_999m, 4, minInclusive: false);
                    lines.Add((null, desc, qty, OptText(it, "uom", 50) ?? "", price, await ItemTypeInCompanyAsync(it, companyId)));
                }
                await CheckDecimalUnitsAsync(lines.Where(l => l.Unit.Length > 0).Select(l => (l.Unit, l.Quantity)));
            }

            // The service sums unrounded line totals, rounds GST half-to-even, and the column rounds the rest.
            var unrounded = lines.Sum(l => l.Quantity * l.UnitPrice);
            var gstAmount = Math.Round(unrounded * gst / 100m, 2);
            var subtotal = RoundAway(unrounded);
            var grand = RoundAway(unrounded + gstAmount);
            var commercial = CommercialTotalCalculator.Total(grand, freight);

            var payload = new
            {
                companyId, clientId = client.Id, clientName = client.Name, date = date.ToString("yyyy-MM-dd"), gstRate = gst,
                paymentTerms = OptText(args, "paymentTerms", 200), paymentMode = string.IsNullOrEmpty(mode) ? null : mode,
                poNumber = OptText(args, "poNumber", 100), poDate = OptDate(args, "poDate")?.ToString("yyyy-MM-dd"), notes = OptText(args, "notes", 2000),
                challanIds, standalone = !fromChallans,
                items = lines.Select(l => new { l.DeliveryItemId, l.Description, l.Quantity, l.Unit, l.UnitPrice, l.ItemTypeId, lineTotal = RoundAway(l.Quantity * l.UnitPrice) }),
                subtotal, gstAmount, grandTotal = grand, freightCharges = freight, commercialTotal = commercial, currency = "PKR",
                note = "The bill number is assigned when it is saved. The ERP finalises the exact figures and reports them back. It is not submitted to FBR.",
            };
            var what = fromChallans ? $"Bill challan(s) {string.Join(", ", challanIds!)}" : "Create a standalone bill";
            var summary = $"{what} for \"{client.Name}\" in company {companyId}: {lines.Count} line(s), GST {gst}%, freight {freight:0.00}, commercial total about {commercial:0.00} PKR";
            return await StorePlanAsync(agent, fromChallans ? "bill.create" : "bill.standalone", companyId, payload, summary, key);
        }

        // ── commit helpers ─────────────────────────────────────────────────

        /// <summary>Ceiling on documents an agent token may commit in an hour, so a runaway loop cannot burn numbers.</summary>
        private async Task EnforceHourlyCapAsync(McpAgentToken agent, string kind)
        {
            var (prefix, cap, noun) = kind.StartsWith("bill.", StringComparison.Ordinal) ? ("bill.", BillsPerHour, "bills")
                : kind == "challan.create" ? ("challan.", ChallansPerHour, "challans") : ("", int.MaxValue, "");
            if (cap == int.MaxValue) return;
            var since = DateTime.UtcNow.AddHours(-1);
            var done = await _context.McpPendingActions.CountAsync(a => a.AgentTokenId == agent.Id && a.CommittedAt != null && a.CommittedAt > since
                && a.Kind.StartsWith(prefix) && a.ResultRef != null && a.ResultRef != "FAILED");
            if (done >= cap) throw new ToolError($"This token has already created {cap} {noun} in the last hour. Try again later, or create the rest by hand.");
        }

        private static DeliveryChallanDto ChallanFromPlan(JsonElement p, int companyId)
        {
            string? S(string n) => p.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            DateTime? D(string n) => S(n) is { } s ? DateTime.ParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture) : null;
            return new DeliveryChallanDto
            {
                CompanyId = companyId, ClientId = p.GetProperty("clientId").GetInt32(), DeliveryDate = D("deliveryDate"), PoNumber = S("poNumber") ?? "",
                PoDate = D("poDate"), IndentNo = S("indentNo"), Site = S("site"), Notes = S("notes"),
                Items = p.GetProperty("items").EnumerateArray().Select(i => new DeliveryItemDto
                {
                    Description = i.GetProperty("description").GetString()!, Quantity = i.GetProperty("quantity").GetDecimal(), Unit = i.GetProperty("unit").GetString()!,
                    ItemTypeId = i.TryGetProperty("itemTypeId", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt32() : null,
                }).ToList(),
            };
        }

        private static (DateTime Date, string? Terms, string? Mode, string? Po, DateTime? PoDate, string? Notes) BillHeader(JsonElement p)
        {
            string? S(string n) => p.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            return (DateTime.ParseExact(S("date")!, "yyyy-MM-dd", CultureInfo.InvariantCulture), S("paymentTerms"), S("paymentMode"), S("poNumber"),
                S("poDate") is { } d ? DateTime.ParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture) : null, S("notes"));
        }

        private static CreateInvoiceDto BillFromChallansPlan(JsonElement p, int companyId)
        {
            var h = BillHeader(p);
            return new CreateInvoiceDto
            {
                CompanyId = companyId, ClientId = p.GetProperty("clientId").GetInt32(), Date = h.Date, GSTRate = p.GetProperty("gstRate").GetDecimal(),
                PaymentTerms = h.Terms, PaymentMode = h.Mode, PoNumber = h.Po, PoDate = h.PoDate, Notes = h.Notes,
                FreightCharges = p.TryGetProperty("freightCharges", out var freight) ? CommercialTotalCalculator.Validate(freight.GetDecimal()) : 0m,
                ChallanIds = p.GetProperty("challanIds").EnumerateArray().Select(e => e.GetInt32()).ToList(),
                Items = p.GetProperty("items").EnumerateArray().Select(i => new CreateInvoiceItemDto
                {
                    DeliveryItemId = i.GetProperty("deliveryItemId").GetInt32(), UnitPrice = i.GetProperty("unitPrice").GetDecimal(),
                    Description = i.GetProperty("description").GetString(),
                    ItemTypeId = i.TryGetProperty("itemTypeId", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt32() : null,
                }).ToList(),
            };
        }

        private static CreateStandaloneInvoiceDto StandaloneBillFromPlan(JsonElement p, int companyId)
        {
            var h = BillHeader(p);
            return new CreateStandaloneInvoiceDto
            {
                CompanyId = companyId, ClientId = p.GetProperty("clientId").GetInt32(), Date = h.Date, GSTRate = p.GetProperty("gstRate").GetDecimal(),
                PaymentTerms = h.Terms, PaymentMode = h.Mode, PoNumber = h.Po, PoDate = h.PoDate, Notes = h.Notes,
                FreightCharges = p.TryGetProperty("freightCharges", out var freight) ? CommercialTotalCalculator.Validate(freight.GetDecimal()) : 0m,
                Items = p.GetProperty("items").EnumerateArray().Select(i => new CreateStandaloneInvoiceItemDto
                {
                    Description = i.GetProperty("description").GetString()!, Quantity = i.GetProperty("quantity").GetDecimal(),
                    UOM = i.TryGetProperty("unit", out var u) && u.ValueKind == JsonValueKind.String && u.GetString()!.Length > 0 ? u.GetString() : null,
                    UnitPrice = i.GetProperty("unitPrice").GetDecimal(),
                    ItemTypeId = i.TryGetProperty("itemTypeId", out var t) && t.ValueKind == JsonValueKind.Number ? t.GetInt32() : null,
                }).ToList(),
            };
        }
    }
}
