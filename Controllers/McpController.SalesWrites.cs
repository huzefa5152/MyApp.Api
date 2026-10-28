using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Write tools for master data and the sales side. Each Build checks, for ONE company, the
    /// screen's permission, the screen's division rule and the ownership of every linked record,
    /// and returns what the plan shows plus the commit, which calls the screen's own service.
    /// Build runs at prepare AND again at commit, so nothing checked here can be stale.
    /// </summary>
    public partial class McpController
    {
        private const int MaxDocLines = 50;

        private static readonly object DocLine = new
        {
            type = "object", additionalProperties = false, required = new[] { "description", "quantity", "unit" },
            properties = new
            {
                description = Str(500), quantity = new { type = "string", description = "Greater than 0, up to 4 decimals." },
                unit = Str(50), unitPrice = MoneyProp, itemTypeId = Int("From search_item_types."),
                id = Int("When editing: the existing line's id (from the get_ tool) to keep that line; omit for a new line."),
            },
        };

        // A bill line may name an FBR HS code the company has no item for yet,
        // instead of an itemTypeId: the item is made when the bill is committed,
        // in the bill's own transaction (Helpers/NewItemTypes), and only for a
        // caller who may add catalog items. Same rule as the Invoices screen.
        private static readonly object BillLine = new
        {
            type = "object", additionalProperties = false, required = new[] { "description", "quantity", "unit" },
            properties = new
            {
                description = Str(500), quantity = new { type = "string", description = "Greater than 0, up to 4 decimals." },
                unit = Str(50), unitPrice = MoneyProp, itemTypeId = Int("From search_item_types."),
                newItemType = new
                {
                    type = "object", additionalProperties = false, required = new[] { "name", "hsCode" },
                    description = "Instead of itemTypeId: an item to add to this company's catalog when the bill is committed (needs the Item Catalog add right). An item of that name and HS code the company already has is reused.",
                    properties = new { name = Str(100), hsCode = Str(20, "A Pakistan Customs Tariff code, e.g. 8481.8090.") },
                },
                id = Int("When editing: the existing line's id (from the get_ tool) to keep that line; omit for a new line."),
            },
        };

        /// <summary>Make the lines' new catalog items and save the bill in ONE transaction.</summary>
        private async Task<T> WithNewItemsAsync<T>(int companyId, IEnumerable<INewItemTypeLine> lines, Func<Task<T>> save)
        {
            if (!NewItemTypes.Any(lines)) return await save();
            await using var tx = await _context.Database.BeginTransactionAsync();
            await NewItemTypes.ResolveAsync(_context, Svc<IItemTypeService>(), companyId, lines);
            var result = await save();
            await tx.CommitAsync();
            return result;
        }

        private void AddSalesWriteTools(List<Tool> t)
        {
            var party = new Dictionary<string, object>
            {
                ["companyId"] = CompanyProp, ["name"] = Str(200), ["address"] = Str(500), ["phone"] = Str(50), ["email"] = Str(200),
                ["ntn"] = Str(50), ["strn"] = Str(50), ["cnic"] = Str(50), ["site"] = Str(200),
                ["registrationType"] = new { type = "string", @enum = new[] { "Registered", "Unregistered" } },
                ["fbrProvinceCode"] = Int(), ["idempotencyKey"] = IdemProp,
            };
            t.AddRange(new Tool[]
            {
                new("prepare_client", "Prepare a new customer, or an update when clientId is given (only the fields you pass change). Nothing is saved: returns a plan to show the person; commit_action only after they approve.",
                    Obj(new Dictionary<string, object>(party) { ["clientId"] = Int("Omit to create.") }, "companyId"),
                    Build: BuildClientAsync, PerHour: 30, Noun: "customer changes"),
                new("prepare_supplier", "Prepare a new supplier, or an update when supplierId is given (only the fields you pass change). Nothing is saved until commit_action.",
                    Obj(new Dictionary<string, object>(party) { ["supplierId"] = Int("Omit to create.") }, "companyId"),
                    Build: BuildSupplierAsync, PerHour: 30, Noun: "supplier changes"),
                new("prepare_item_type", "Prepare a new item for this company, or an update when itemTypeId is given. displayName is this company's own name for the item (other companies keep theirs). An item also held by a company outside your access cannot be changed here. Nothing is saved until commit_action.",
                    Obj(new { companyId = CompanyProp, itemTypeId = Int("Omit to create."), name = Str(200), displayName = Str(300, "This company's own name for the item; empty clears it."), hsCode = Str(20), uom = Str(50), saleType = Str(100), idempotencyKey = IdemProp }, "companyId"),
                    Build: BuildItemTypeAsync, PerHour: 30, Noun: "item changes"),
                new("prepare_quote", "Prepare a sales quotation, or an edit of one when quoteId is given (send the whole quotation; lines keep their id from get_quote). Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, quoteId = Int("Edit this quotation."), clientId = Int(), divisionId = DivisionProp, date = DateProp, validUntil = DateProp,
                        customerEnquiryRef = Str(200), enquiryDate = DateProp, notes = Str(2000),
                        gstRate = new { type = "string", description = "Percent, up to 2 decimals. Default 18." },
                        items = new { type = "array", minItems = 1, maxItems = MaxDocLines, items = DocLine }, idempotencyKey = IdemProp,
                    }, "companyId", "clientId", "items"),
                    Build: BuildQuoteAsync, PerHour: 30, Noun: "quotations"),
                new("prepare_sales_order", "Prepare a sales order: from items, by converting a quotation (quoteId), or an edit when salesOrderId is given (send the whole order; lines keep their id from get_sales_order). Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, quoteId = Int("Convert this quotation instead of giving items."), salesOrderId = Int("Edit this sales order."), clientId = Int(), divisionId = DivisionProp,
                        orderDate = DateProp, requiredDate = DateProp, customerPoNumber = Str(100), customerPoDate = DateProp, site = Str(300), notes = Str(2000),
                        items = new { type = "array", minItems = 1, maxItems = MaxDocLines, items = DocLine }, idempotencyKey = IdemProp,
                    }, "companyId"),
                    Build: BuildSalesOrderAsync, PerHour: 30, Noun: "sales orders"),
                new("prepare_challan", "Prepare a delivery challan (no prices): from items for a customer, deliver lines of a sales order (salesOrderId + lines with salesOrderItemId from get_sales_order), or edit one when challanId is given (send its items; lines keep their id from get_challan). Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, challanId = Int("Edit this challan."), clientId = Int(), divisionId = DivisionProp, deliveryDate = DateProp,
                        poNumber = Str(100, "Optional. A challan without a PO can be billed."), poDate = DateProp, indentNo = Str(100), site = Str(300),
                        items = new { type = "array", minItems = 1, maxItems = MaxDocLines, items = DocLine },
                        salesOrderId = Int("Deliver this sales order instead of giving items."),
                        lines = new { type = "array", minItems = 1, maxItems = MaxDocLines, items = new { type = "object", additionalProperties = false, required = new[] { "salesOrderItemId", "quantity" }, properties = new { salesOrderItemId = Int(), quantity = new { type = "string" }, itemTypeId = Int() } } },
                        idempotencyKey = IdemProp,
                    }, "companyId", "deliveryDate"),
                    Build: BuildChallanAsync, PerHour: 30, Noun: "challans"),
                new("prepare_bill", "Prepare a sale invoice (the Invoices screen; the name keeps the old word). With challanIds it bills those challans (give a unitPrice for EVERY challan line, deliveryItemId from get_challan); without, a standalone invoice from items. An item line takes itemTypeId, or newItemType (name + FBR HS code) to add that item to the catalog on commit, in the same transaction; a company that blocks selling below stock refuses an item with no stock, as the screen does. With billId it edits that bill: send the whole bill as items, each existing line with its id from get_invoice. A new bill takes the next number of the legal invoice sequence when committed; nothing is submitted to FBR here.",
                    Obj(new
                    {
                        companyId = CompanyProp, billId = Int("Edit this bill."), clientId = Int(), divisionId = DivisionProp,
                        date = new { type = "string", format = "date", description = "Defaults to today (Pakistan time); never in the future." },
                        gstRate = new { type = "string", description = "Percent, up to 2 decimals. Default 18." },
                        paymentTerms = Str(200), paymentMode = Str(50), poNumber = Str(100), poDate = DateProp,
                        advanceTaxSection = Str(20, "Optional advance tax section, as on the bill form."), advanceTaxFilerActive = new { type = "boolean" },
                        furtherTaxRate = new { type = "string", description = "Optional further tax percent." },
                        taxRateOverrideReason = Str(500, "Needed when the GST rate differs from the rate the goods were imported at."),
                        challanIds = new { type = "array", minItems = 1, maxItems = 20, items = new { type = "integer", minimum = 1 } },
                        prices = new { type = "array", maxItems = 500, items = new { type = "object", additionalProperties = false, required = new[] { "deliveryItemId", "unitPrice" }, properties = new { deliveryItemId = Int(), unitPrice = new { type = "string" }, description = Str(500), itemTypeId = Int() } } },
                        items = new { type = "array", maxItems = MaxDocLines, items = BillLine },
                        idempotencyKey = IdemProp,
                    }, "companyId"),
                    Build: BuildBillAsync, PerHour: 10, Noun: "bills"),
                new("validate_bill_fbr", "Validate a bill with FBR (PRAL's validate endpoint) and return FBR's verdict and item errors. Never submits and issues no FBR number. Uses the company's own FBR token, so it is capped per hour.",
                    Obj(new { companyId = CompanyProp, invoiceId = Int(), scenarioId = Str(10, "Optional FBR scenario such as SN001.") }, "companyId", "invoiceId"),
                    Read: ValidateBillFbrAsync),
            });
        }

        // ── shared parsing ─────────────────────────────────────────────────

        private sealed record Line(string Description, decimal Quantity, string Unit, decimal? UnitPrice, int? ItemTypeId, int? Id = null, NewItemTypeDto? NewItem = null);

        private async Task<List<Line>> DocLinesAsync(JsonElement args, int companyId, bool pricesRequired, bool allowNewItem = false)
        {
            var lines = new List<Line>();
            foreach (var it in Items(args, "items", 1, MaxDocLines))
            {
                var desc = OptText(it, "description", 500);
                var unit = OptText(it, "unit", 50);
                if (string.IsNullOrEmpty(desc)) throw new ToolError("Item descriptions cannot be empty.");
                if (string.IsNullOrEmpty(unit)) throw new ToolError("Item units cannot be empty.");
                var qty = ReqDec(it, "quantity", 0m, 999_999_999m, 4, minInclusive: false);
                var price = pricesRequired ? ReqDec(it, "unitPrice", 0m, 999_999_999m, 4, minInclusive: false) : OptDec(it, "unitPrice", 0m, 999_999_999m, 4);
                NewItemTypeDto? newItem = null;
                if (allowNewItem && it.TryGetProperty("newItemType", out var ni) && ni.ValueKind == JsonValueKind.Object)
                {
                    if (Has(it, "itemTypeId")) throw new ToolError("A line takes either itemTypeId or newItemType, not both.");
                    var niName = OptText(ni, "name", 100);
                    var niHs = OptText(ni, "hsCode", 20);
                    if (string.IsNullOrEmpty(niName) || string.IsNullOrEmpty(niHs)) throw new ToolError("newItemType needs a name and an hsCode.");
                    newItem = new NewItemTypeDto { Name = niName, HsCode = niHs, Uom = unit };
                }
                lines.Add(new Line(desc, qty, unit, price, newItem != null ? null : await ItemInCompanyAsync(it, "itemTypeId", companyId), OptId(it, "id"), newItem));
            }
            return lines;
        }

        private static decimal Gst(JsonElement args) => OptDec(args, "gstRate", 0, 100, 2) ?? 18m;

        private async Task<string> ClientNameAsync(int clientId) =>
            await _context.Clients.AsNoTracking().Where(c => c.Id == clientId).Select(c => c.Name).FirstAsync();

        // ── customers and suppliers ────────────────────────────────────────

        /// <summary>The fields a customer and a supplier share, applied over the stored record.</summary>
        private static void ApplyParty(JsonElement args, Action<string> name, Action<string?> address, Action<string?> phone, Action<string?> email,
            Action<string?> ntn, Action<string?> strn, Action<string?> cnic, Action<string?> site, Action<string> registration, Action<int> province)
        {
            static string? Blank(string s) => s.Length == 0 ? null : s;
            if (OptText(args, "name", 200) is { Length: > 0 } n) name(n);
            if (OptText(args, "address", 500) is { } a) address(Blank(a));
            if (OptText(args, "phone", 50) is { } p) phone(Blank(p));
            if (OptText(args, "email", 200) is { } e)
            {
                if (e.Length > 0 && !e.Contains('@')) throw new ToolError("email does not look like an email address.");
                email(Blank(e));
            }
            if (OptText(args, "ntn", 50) is { } nt) ntn(Blank(nt));
            if (OptText(args, "strn", 50) is { } st) strn(Blank(st));
            if (OptText(args, "cnic", 50) is { } cn) cnic(Blank(cn));
            if (OptText(args, "site", 200) is { } si) site(Blank(si));
            if (OptText(args, "registrationType", 20) is { } rt)
                registration(rt is "Registered" or "Unregistered" ? rt : throw new ToolError("registrationType must be Registered or Unregistered."));
            if (Has(args, "fbrProvinceCode")) province(IdArg(args, "fbrProvinceCode"));
        }

        private async Task<Built> BuildClientAsync(int companyId, JsonElement args)
        {
            var clientId = OptId(args, "clientId");
            await Need(clientId.HasValue ? "clients.manage.update" : "clients.manage.create");
            // An update plan echoes the stored contact details back, so it needs the right that reads them.
            if (clientId.HasValue) await Need("clients.manage.view");
            var service = Svc<IClientService>();
            ClientDto dto;
            if (clientId.HasValue)
            {
                var existing = await service.GetByIdAsync(clientId.Value);
                if (existing == null || existing.CompanyId != companyId) throw new ToolError(Denied);
                dto = existing;
            }
            else dto = new ClientDto { CompanyId = companyId, Name = OptText(args, "name", 200) is { Length: > 0 } n ? n : throw new ToolError("name is required to create a customer.") };
            ApplyParty(args, v => dto.Name = v, v => dto.Address = v, v => dto.Phone = v, v => dto.Email = v, v => dto.NTN = v, v => dto.STRN = v,
                v => dto.CNIC = v, v => dto.Site = v, v => dto.RegistrationType = v, v => dto.FbrProvinceCode = v);
            var clash = (await service.GetByCompanyAsync(companyId)).FirstOrDefault(c => c.Id != dto.Id && string.Equals(c.Name, dto.Name, StringComparison.OrdinalIgnoreCase));
            if (clash != null) throw new ToolError($"A customer named \"{clash.Name}\" already exists in this company (id {clash.Id}).");
            var preview = new { dto.Id, dto.CompanyId, dto.Name, dto.Address, dto.Phone, dto.Email, dto.NTN, dto.STRN, dto.CNIC, dto.Site, dto.RegistrationType, dto.FbrProvinceCode };
            return new Built(preview, clientId.HasValue ? $"Update customer #{dto.Id} \"{dto.Name}\" in company {companyId}" : $"Create customer \"{dto.Name}\" in company {companyId}",
                async () =>
                {
                    var saved = clientId.HasValue ? await service.UpdateAsync(dto) : await service.CreateAsync(dto);
                    return ($"Client:{saved.Id}", $"{(clientId.HasValue ? "Updated" : "Created")} customer #{saved.Id} \"{saved.Name}\"");
                });
        }

        private async Task<Built> BuildSupplierAsync(int companyId, JsonElement args)
        {
            var supplierId = OptId(args, "supplierId");
            await Need(supplierId.HasValue ? "suppliers.manage.update" : "suppliers.manage.create");
            if (supplierId.HasValue) await Need("suppliers.manage.view");
            var service = Svc<ISupplierService>();
            SupplierDto dto;
            if (supplierId.HasValue)
            {
                var existing = await service.GetByIdAsync(supplierId.Value);
                if (existing == null || existing.CompanyId != companyId) throw new ToolError(Denied);
                dto = existing;
            }
            else dto = new SupplierDto { CompanyId = companyId, Name = OptText(args, "name", 200) is { Length: > 0 } n ? n : throw new ToolError("name is required to create a supplier.") };
            ApplyParty(args, v => dto.Name = v, v => dto.Address = v, v => dto.Phone = v, v => dto.Email = v, v => dto.NTN = v, v => dto.STRN = v,
                v => dto.CNIC = v, v => dto.Site = v, v => dto.RegistrationType = v, v => dto.FbrProvinceCode = v);
            var clash = (await service.GetByCompanyAsync(companyId)).FirstOrDefault(c => c.Id != dto.Id && string.Equals(c.Name, dto.Name, StringComparison.OrdinalIgnoreCase));
            if (clash != null) throw new ToolError($"A supplier named \"{clash.Name}\" already exists in this company (id {clash.Id}).");
            var preview = new { dto.Id, dto.CompanyId, dto.Name, dto.Address, dto.Phone, dto.Email, dto.NTN, dto.STRN, dto.CNIC, dto.Site, dto.RegistrationType, dto.FbrProvinceCode };
            return new Built(preview, supplierId.HasValue ? $"Update supplier #{dto.Id} \"{dto.Name}\" in company {companyId}" : $"Create supplier \"{dto.Name}\" in company {companyId}",
                async () =>
                {
                    var saved = supplierId.HasValue ? await service.UpdateAsync(dto) : await service.CreateAsync(dto);
                    return ($"Supplier:{saved.Id}", $"{(supplierId.HasValue ? "Updated" : "Created")} supplier #{saved.Id} \"{saved.Name}\"");
                });
        }

        // ── items ──────────────────────────────────────────────────────────

        // POST/PUT /api/itemtypes?companyId= : the catalog row is shared, so an item another
        // company outside the caller's access also holds is refused (the screen's rule), and the
        // company's own wording goes on its overlay (DisplayName), never on the shared row.
        private async Task<Built> BuildItemTypeAsync(int companyId, JsonElement args)
        {
            var itemTypeId = OptId(args, "itemTypeId");
            await Need(itemTypeId.HasValue ? "itemtypes.manage.update" : "itemtypes.manage.create");
            if (itemTypeId.HasValue) await Need("itemtypes.manage.view");
            var service = Svc<IItemTypeService>();
            var accessible = (await _access.GetAccessibleCompanyIdsAsync(CurrentUserId)).ToList();
            ItemTypeDto dto;
            if (itemTypeId.HasValue)
            {
                if (!await service.IsVisibleToAsync(itemTypeId.Value, new[] { companyId })) throw new ToolError(Denied);
                if (await service.IsHeldOutsideAsync(itemTypeId.Value, accessible))
                    throw new ToolError("This item is also used by another company, so it cannot be changed from here.");
                dto = await service.GetByIdAsync(itemTypeId.Value, companyId) ?? throw new ToolError(Denied);
            }
            else dto = new ItemTypeDto { Name = OptText(args, "name", 200) is { Length: > 0 } n ? n : throw new ToolError("name is required to create an item."), IsFavorite = true };
            if (OptText(args, "name", 200) is { Length: > 0 } nm) dto.Name = nm;
            if (OptText(args, "hsCode", 20) is { } hs)
            {
                if (hs.Length > 0 && !hs.All(c => char.IsDigit(c) || c == '.')) throw new ToolError("hsCode may contain digits and dots only, e.g. 8481.8090.");
                dto.HSCode = hs.Length == 0 ? null : hs;
            }
            if (OptText(args, "uom", 50) is { } uom) dto.UOM = uom.Length == 0 ? null : uom;
            if (OptText(args, "saleType", 100) is { } sale) dto.SaleType = sale.Length == 0 ? null : sale;
            if (OptText(args, "displayName", 300) is { } own)
            {
                dto.WriteCompanyOverlay = true;
                dto.CompanyDisplayName = own;
            }
            var preview = new
            {
                dto.Id, companyId, dto.Name, displayName = dto.CompanyDisplayName, hsCode = dto.HSCode, uom = dto.UOM, dto.SaleType,
                writesCompanyName = dto.WriteCompanyOverlay,
                note = string.IsNullOrEmpty(dto.HSCode) ? "No HS code: an unclassified item that cannot be filed with FBR until classified." : "The HS code is checked when committed.",
            };
            return new Built(preview,
                itemTypeId.HasValue ? $"Update item #{dto.Id} \"{dto.Name}\" in company {companyId}" : $"Create item \"{dto.Name}\" (HS {dto.HSCode ?? "none"}) in company {companyId}",
                async () =>
                {
                    var saved = itemTypeId.HasValue
                        ? await service.UpdateAsync(dto.Id, dto, companyId, accessible) ?? throw new KeyNotFoundException("The item no longer exists.")
                        : await service.CreateAsync(dto, companyId);
                    return ($"ItemType:{saved.Id}", $"{(itemTypeId.HasValue ? "Updated" : "Created")} item #{saved.Id} \"{saved.CompanyDisplayName ?? saved.Name}\"");
                });
        }

        // ── quotes, orders, challans ───────────────────────────────────────

        private async Task<Built> BuildQuoteAsync(int companyId, JsonElement args)
        {
            var editId = OptId(args, "quoteId");
            await Need(editId == null ? "salesquotes.manage.create" : "salesquotes.manage.update");
            var clientId = (await ClientInCompanyAsync(args, companyId))!.Value;
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var gst = Gst(args);
            var lines = await DocLinesAsync(args, companyId, pricesRequired: true);
            var dto = new SalesQuoteDto
            {
                ClientId = clientId, DivisionId = division, Date = DateArg(args, "date") ?? PakistanClock.Today, ValidUntil = DateArg(args, "validUntil"),
                CustomerEnquiryRef = OptText(args, "customerEnquiryRef", 200), EnquiryDate = DateArg(args, "enquiryDate"), Notes = OptText(args, "notes", 2000), GSTRate = gst,
                Items = lines.Select(l => new SalesQuoteItemDto { Description = l.Description, Quantity = l.Quantity, Unit = l.Unit, UnitPrice = l.UnitPrice!.Value, ItemTypeId = l.ItemTypeId, LineTotal = Math.Round(l.Quantity * l.UnitPrice!.Value, 2) }).ToList(),
            };
            var subtotal = dto.Items.Sum(i => i.LineTotal);
            var name = await ClientNameAsync(clientId);
            var preview = new { clientId, clientName = name, divisionId = division, date = Ymd(dto.Date), validUntil = Ymd(dto.ValidUntil), dto.Notes, gstRate = gst,
                items = dto.Items.Select(i => new { i.Description, i.Quantity, i.Unit, i.UnitPrice, i.ItemTypeId, i.LineTotal }), subtotal, gstAbout = Math.Round(subtotal * gst / 100m, 2), currency = "PKR" };
            if (editId is int qid) return await EditQuoteAsync(companyId, qid, dto, lines, preview, args);
            return new Built(preview, $"Create a quotation for \"{name}\" in company {companyId}: {lines.Count} line(s), subtotal {subtotal:0.00} PKR, GST {gst}%",
                async () =>
                {
                    var q = await Svc<ISalesQuoteService>().CreateAsync(companyId, dto);
                    return ($"SalesQuote:{q.Id}", $"Created quotation #{q.QuoteNumber} (id {q.Id}) for \"{q.ClientName}\", total {q.GrandTotal:0.00} PKR");
                });
        }

        private async Task<Built> BuildSalesOrderAsync(int companyId, JsonElement args)
        {
            var editId = OptId(args, "salesOrderId");
            await Need(editId == null ? "salesorders.manage.create" : "salesorders.manage.update");
            var orders = Svc<ISalesOrderService>();
            if (OptId(args, "quoteId") is int quoteId)
            {
                if (Has(args, "items") || Has(args, "clientId") || editId != null) throw new ToolError("Converting a quotation takes quoteId only.");
                var quote = await Svc<ISalesQuoteService>().GetByIdAsync(quoteId);
                if (quote == null || quote.CompanyId != companyId) throw new ToolError(Denied);
                // The new order inherits the quote's division: read access to it is the screen's gate.
                await AssertDivisionReadAsync(companyId, quote.DivisionId);
                if (quote.ConvertedToSalesOrderId != null) throw new ToolError($"Quotation #{quote.QuoteNumber} is already converted to a sales order.");
                var preview0 = new { quoteId, quote.QuoteNumber, quote.ClientId, quote.ClientName, quote.DivisionId, quote.GrandTotal, lineCount = quote.Items.Count };
                return new Built(preview0, $"Convert quotation #{quote.QuoteNumber} for \"{quote.ClientName}\" into a sales order in company {companyId}",
                    async () =>
                    {
                        var o = await Svc<ISalesQuoteService>().ConvertToSalesOrderAsync(quoteId);
                        return ($"SalesOrder:{o.Id}", $"Created sales order #{o.SalesOrderNumber} (id {o.Id}) from quotation #{quote.QuoteNumber}");
                    });
            }
            var clientId = (await ClientInCompanyAsync(args, companyId))!.Value;
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var lines = await DocLinesAsync(args, companyId, pricesRequired: false);
            var dto = new SalesOrderDto
            {
                ClientId = clientId, DivisionId = division, OrderDate = DateArg(args, "orderDate") ?? PakistanClock.Today, RequiredDate = DateArg(args, "requiredDate"),
                CustomerPoNumber = OptText(args, "customerPoNumber", 100), CustomerPoDate = DateArg(args, "customerPoDate"), Site = OptText(args, "site", 300), Notes = OptText(args, "notes", 2000),
                Items = lines.Select(l => new SalesOrderItemDto { Description = l.Description, Quantity = l.Quantity, Unit = l.Unit, UnitPrice = l.UnitPrice, ItemTypeId = l.ItemTypeId }).ToList(),
            };
            var name = await ClientNameAsync(clientId);
            var preview = new { clientId, clientName = name, divisionId = division, orderDate = Ymd(dto.OrderDate), requiredDate = Ymd(dto.RequiredDate), dto.CustomerPoNumber,
                items = dto.Items.Select(i => new { i.Description, i.Quantity, i.Unit, i.UnitPrice, i.ItemTypeId }) };
            if (editId is int oid) return await EditSalesOrderAsync(companyId, oid, dto, lines, preview, args);
            return new Built(preview, $"Create a sales order for \"{name}\" in company {companyId}: {lines.Count} line(s)",
                async () =>
                {
                    var o = await orders.CreateAsync(companyId, dto);
                    return ($"SalesOrder:{o.Id}", $"Created sales order #{o.SalesOrderNumber} (id {o.Id}) for \"{o.ClientName}\"");
                });
        }

        private async Task<Built> BuildChallanAsync(int companyId, JsonElement args)
        {
            var editId = OptId(args, "challanId");
            await Need(editId == null ? "challans.manage.create" : "challans.manage.update");
            var delivery = DateArg(args, "deliveryDate") ?? throw new ToolError("deliveryDate is required.");
            if (OptId(args, "salesOrderId") is int orderId)
            {
                if (editId != null) throw new ToolError("Editing a challan takes its items, not a sales order.");
                if (Has(args, "items") || Has(args, "clientId")) throw new ToolError("Delivering a sales order takes salesOrderId and lines, not items.");
                var orders = Svc<ISalesOrderService>();
                var order = await orders.GetByIdAsync(orderId);
                if (order == null || order.CompanyId != companyId) throw new ToolError(Denied);
                // The challan inherits the order's division: read access to it is the screen's gate.
                await AssertDivisionReadAsync(companyId, order.DivisionId);
                var byId = order.Items.ToDictionary(i => i.Id);
                var deliver = new List<DeliverLineDto>();
                foreach (var l in Items(args, "lines", 1, MaxDocLines))
                {
                    var lineId = IdArg(l, "salesOrderItemId");
                    if (!byId.TryGetValue(lineId, out var ol)) throw new ToolError($"Line {lineId} is not on sales order #{order.SalesOrderNumber}.");
                    if (deliver.Any(d => d.SalesOrderItemId == lineId)) throw new ToolError($"Line {lineId} is given twice.");
                    var qty = ReqDec(l, "quantity", 0m, 999_999_999m, 4, minInclusive: false);
                    if (qty > ol.RemainingQuantity) throw new ToolError($"Line {lineId} has only {ol.RemainingQuantity} left to deliver.");
                    deliver.Add(new DeliverLineDto { SalesOrderItemId = lineId, Quantity = qty, ItemTypeId = await ItemInCompanyAsync(l, "itemTypeId", companyId) });
                }
                var dto0 = new CreateChallanFromOrderDto { DeliveryDate = delivery, Site = OptText(args, "site", 300), Lines = deliver };
                var preview0 = new { salesOrderId = orderId, order.SalesOrderNumber, order.ClientName, order.DivisionId, deliveryDate = Ymd(delivery), dto0.Site,
                    lines = deliver.Select(d => new { d.SalesOrderItemId, byId[d.SalesOrderItemId].Description, d.Quantity, byId[d.SalesOrderItemId].Unit }) };
                return new Built(preview0, $"Deliver {deliver.Count} line(s) of sales order #{order.SalesOrderNumber} for \"{order.ClientName}\" on {Ymd(delivery)} in company {companyId}",
                    async () =>
                    {
                        var c = await orders.CreateChallanFromOrderAsync(orderId, dto0);
                        return ($"DeliveryChallan:{c.Id}", $"Created challan #{c.ChallanNumber} (id {c.Id}) from sales order #{order.SalesOrderNumber}, status {c.Status}");
                    });
            }
            if (Has(args, "lines")) throw new ToolError("lines delivers a sales order (give salesOrderId). For a challan from items, give items.");
            var clientId = (await ClientInCompanyAsync(args, companyId))!.Value;
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var lines = await DocLinesAsync(args, companyId, pricesRequired: false);
            var po = OptText(args, "poNumber", 100) ?? "";
            var dto = new DeliveryChallanDto
            {
                CompanyId = companyId, ClientId = clientId, DivisionId = division, DeliveryDate = delivery, PoNumber = po,
                PoDate = po.Length > 0 ? DateArg(args, "poDate") : null, IndentNo = OptText(args, "indentNo", 100), Site = OptText(args, "site", 300),
                Items = lines.Select(l => new DeliveryItemDto { Description = l.Description, Quantity = l.Quantity, Unit = l.Unit, ItemTypeId = l.ItemTypeId }).ToList(),
            };
            var name = await ClientNameAsync(clientId);
            var preview = new { clientId, clientName = name, divisionId = division, deliveryDate = Ymd(delivery), poNumber = po, poDate = Ymd(dto.PoDate), dto.Site,
                items = dto.Items.Select(i => new { i.Description, i.Quantity, i.Unit, i.ItemTypeId }) };
            if (editId is int chid) return await EditChallanAsync(companyId, chid, dto, lines, preview, args);
            return new Built(preview, $"Create a delivery challan for \"{name}\" in company {companyId}: {lines.Count} line(s), delivery {Ymd(delivery)}, " + (po.Length > 0 ? $"PO {po}" : "no PO"),
                async () =>
                {
                    var c = await Svc<IDeliveryChallanService>().CreateDeliveryChallanAsync(companyId, dto);
                    return ($"DeliveryChallan:{c.Id}", $"Created challan #{c.ChallanNumber} (id {c.Id}) for \"{c.ClientName}\", status {c.Status}");
                });
        }

        // ── bills ──────────────────────────────────────────────────────────

        private async Task<Built> BuildBillAsync(int companyId, JsonElement args)
        {
            if (OptId(args, "billId") is int billId) return await EditBillAsync(companyId, billId, args);
            var fromChallans = Has(args, "challanIds");
            await Need(fromChallans ? "bills.manage.create" : "bills.manage.create.standalone");
            var company = await _context.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => new { c.StartingInvoiceNumber }).FirstOrDefaultAsync()
                ?? throw new ToolError(Denied);
            if (company.StartingInvoiceNumber == 0) throw new ToolError("The starting invoice number has not been set for this company.");
            var clientId = (await ClientInCompanyAsync(args, companyId))!.Value;
            var division = OptId(args, "divisionId");
            await AssertDivisionWriteAsync(companyId, division);
            var date = DateArg(args, "date") ?? PakistanClock.Today;
            if (PakistanClock.IsFutureInvoiceDate(date)) throw new ToolError("A bill cannot be dated in the future (FBR rule 0043).");
            var gst = Gst(args);
            var furtherTax = OptDec(args, "furtherTaxRate", 0, 100, 2);
            var advanceSection = OptText(args, "advanceTaxSection", 20) is { Length: > 0 } sec ? sec : null;
            var advanceFiler = OptBool(args, "advanceTaxFilerActive");
            var overrideReason = OptText(args, "taxRateOverrideReason", 500) is { Length: > 0 } why ? why : null;
            var terms = OptText(args, "paymentTerms", 200);
            var mode = OptText(args, "paymentMode", 50) is { Length: > 0 } m ? m : null;
            var poNumber = OptText(args, "poNumber", 100) is { Length: > 0 } po ? po : null;
            var poDate = DateArg(args, "poDate");
            var name = await ClientNameAsync(clientId);
            var invoices = Svc<IInvoiceService>();

            if (fromChallans)
            {
                if (Has(args, "items")) throw new ToolError("Give prices for the challan lines, not items. A standalone bill omits challanIds.");
                var challanIds = args.GetProperty("challanIds").EnumerateArray()
                    .Select(e => e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var n) && n > 0 ? n : throw new ToolError("challanIds must be positive integers.")).Distinct().ToList();
                if (challanIds.Count is < 1 or > 20) throw new ToolError("Choose between 1 and 20 challans.");
                var deliveryItems = new Dictionary<int, DeliveryItemDto>();
                var numbers = new List<int>();
                foreach (var cid in challanIds)
                {
                    var ch = await Svc<IDeliveryChallanService>().GetByIdAsync(cid);
                    if (ch == null || ch.CompanyId != companyId) throw new ToolError($"Challan {cid} was not found in this company.");
                    await AssertDivisionReadAsync(companyId, ch.DivisionId);
                    if (ch.ClientId != clientId) throw new ToolError($"Challan {ch.ChallanNumber} belongs to a different customer than the bill.");
                    if (!Billable(ch)) throw new ToolError($"Challan {ch.ChallanNumber} cannot be billed (status {ch.Status}).");
                    numbers.Add(ch.ChallanNumber);
                    foreach (var i in ch.Items) deliveryItems[i.Id] = i;
                }
                var priced = new List<CreateInvoiceItemDto>();
                foreach (var p in Items(args, "prices", 1, 500))
                {
                    var did = IdArg(p, "deliveryItemId");
                    if (!deliveryItems.TryGetValue(did, out var di)) throw new ToolError($"Line {did} is not on the chosen challans.");
                    var lineItem = await ItemInCompanyAsync(p, "itemTypeId", companyId) ?? di.ItemTypeId;
                    if (lineItem == null) throw new ToolError($"Line {did} needs an itemTypeId (search_item_types).");
                    if (priced.Any(x => x.DeliveryItemId == did)) throw new ToolError($"Line {did} is priced twice.");
                    priced.Add(new CreateInvoiceItemDto
                    {
                        DeliveryItemId = did, UnitPrice = ReqDec(p, "unitPrice", 0m, 999_999_999m, 4, minInclusive: false),
                        Description = OptText(p, "description", 500) is { Length: > 0 } d ? d : di.Description,
                        ItemTypeId = lineItem,
                    });
                }
                var missing = deliveryItems.Keys.Except(priced.Select(x => x.DeliveryItemId)).ToList();
                if (missing.Count > 0) throw new ToolError("Every challan line needs a price. Missing: " + string.Join(", ", missing.Take(10)) + ".");
                var dto = new CreateInvoiceDto
                {
                    CompanyId = companyId, DivisionId = division, ClientId = clientId, Date = date, GSTRate = gst, PaymentTerms = terms, PaymentMode = mode,
                    PoNumber = poNumber, PoDate = poDate, ChallanIds = challanIds, Items = priced, FurtherTaxRate = furtherTax,
                    AdvanceTaxSection = advanceSection, AdvanceTaxFilerActive = advanceFiler, TaxRateOverrideReason = overrideReason,
                };
                var subtotal = Math.Round(priced.Sum(x => deliveryItems[x.DeliveryItemId].Quantity * x.UnitPrice), 2, MidpointRounding.AwayFromZero);
                var preview = new
                {
                    clientId, clientName = name, divisionId = division, date = Ymd(date), gstRate = gst, furtherTaxRate = furtherTax, advanceTaxSection = advanceSection,
                    challanIds, challanNumbers = numbers,
                    lines = priced.Select(x => new { x.DeliveryItemId, x.Description, deliveryItems[x.DeliveryItemId].Quantity, deliveryItems[x.DeliveryItemId].Unit, x.UnitPrice, x.ItemTypeId }),
                    subtotalAbout = subtotal, currency = "PKR",
                    note = "The bill number, taxes and totals are fixed by the ERP when it is saved and reported back. Nothing is sent to FBR.",
                };
                return new Built(preview, $"Bill challan(s) {string.Join(", ", numbers)} for \"{name}\" in company {companyId}: {priced.Count} line(s), subtotal about {subtotal:0.00} PKR, GST {gst}%",
                    async () =>
                    {
                        var b = await invoices.CreateAsync(dto);
                        return ($"Invoice:{b.Id}", $"Created bill #{b.InvoiceNumber} (id {b.Id}) for \"{b.ClientName}\", total {b.GrandTotal:0.00} PKR. Not submitted to FBR");
                    });
            }

            if (Has(args, "prices")) throw new ToolError("prices applies to challan lines. For a standalone bill give items.");
            var lines = await DocLinesAsync(args, companyId, pricesRequired: true, allowNewItem: true);
            if (lines.Any(l => l.ItemTypeId == null && l.NewItem == null)) throw new ToolError("Every bill line needs an itemTypeId (search_item_types) or a newItemType.");
            if (lines.Any(l => l.NewItem != null)) await Need("itemtypes.manage.create");
            var sdto = new CreateStandaloneInvoiceDto
            {
                CompanyId = companyId, DivisionId = division, ClientId = clientId, Date = date, GSTRate = gst, PaymentTerms = terms, PaymentMode = mode,
                PoNumber = poNumber, PoDate = poDate, FurtherTaxRate = furtherTax, AdvanceTaxSection = advanceSection, AdvanceTaxFilerActive = advanceFiler,
                TaxRateOverrideReason = overrideReason,
                Items = lines.Select(l => new CreateStandaloneInvoiceItemDto { Description = l.Description, Quantity = l.Quantity, UOM = l.Unit, UnitPrice = l.UnitPrice!.Value, ItemTypeId = l.ItemTypeId, NewItemType = l.NewItem }).ToList(),
            };
            var sub = Math.Round(lines.Sum(l => l.Quantity * l.UnitPrice!.Value), 2, MidpointRounding.AwayFromZero);
            var spreview = new
            {
                clientId, clientName = name, divisionId = division, date = Ymd(date), gstRate = gst, furtherTaxRate = furtherTax, advanceTaxSection = advanceSection,
                lines = sdto.Items.Select(i => new { i.Description, i.Quantity, unit = i.UOM, i.UnitPrice, i.ItemTypeId, newItem = i.NewItemType == null ? null : new { i.NewItemType.Name, i.NewItemType.HsCode } }),
                subtotalAbout = sub, currency = "PKR",
                note = "The bill number, taxes and totals are fixed by the ERP when it is saved and reported back. Nothing is sent to FBR.",
            };
            return new Built(spreview, $"Create a standalone bill for \"{name}\" in company {companyId}: {lines.Count} line(s), subtotal about {sub:0.00} PKR, GST {gst}%",
                async () =>
                {
                    var b = await WithNewItemsAsync(companyId, sdto.Items, () => invoices.CreateStandaloneAsync(sdto));
                    return ($"Invoice:{b.Id}", $"Created bill #{b.InvoiceNumber} (id {b.Id}) for \"{b.ClientName}\", total {b.GrandTotal:0.00} PKR. Not submitted to FBR");
                });
        }

        private const int FbrValidationsPerHour = 30;

        // POST /api/fbr/{id}/validate: invoices.fbr.validate, against the bill's STORED company and division.
        private async Task<object> ValidateBillFbrAsync(JsonElement args)
        {
            await Need("invoices.fbr.validate");
            var companyId = await CompanyArg(args);
            var bill = await OwnBillAsync(companyId, IdArg(args, "invoiceId"));
            var since = DateTime.UtcNow.AddHours(-1);
            var done = await _context.McpActivities.CountAsync(a => a.UserId == CurrentUserId && a.Tool == "validate_bill_fbr" && a.Outcome == "ok" && a.At > since);
            if (done >= FbrValidationsPerHour) throw new ToolError($"Your AI agents have already validated {FbrValidationsPerHour} bills with FBR in the last hour. Try again later.");
            var result = await Svc<IFbrService>().ValidateInvoiceAsync(bill.Id, OptText(args, "scenarioId", 10) is { Length: > 0 } sc ? sc : null);
            _resultSummary = $"FBR validation of bill #{bill.InvoiceNumber}: {(result.Success ? "valid" : "rejected")}";
            return new
            {
                invoiceId = bill.Id, bill.InvoiceNumber, valid = result.Success, result.FbrStatus, result.ErrorMessage,
                itemErrors = result.ItemErrors?.Select(e => new { e.ItemSNo, e.StatusCode, e.Status, e.ErrorCode, e.Error }),
                submitted = false, note = "Validation only. Submitting to FBR stays a person's action on the Invoices screen.",
            };
        }
    }
}
