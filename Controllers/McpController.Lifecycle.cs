using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The end of a document's life and its trip to FBR: delete, cancel, the FBR-withdrawn marker,
    /// quote and order status, credit and debit notes and supplementary bills, FBR preview, submit,
    /// reset and exclusion, and the FBR log (decision of 2026-10-22: an administrator's agent may do
    /// these for the companies the user holds).
    ///
    /// Each tool resolves the record's STORED company (and division where it carries one) first,
    /// refuses a record of any other company with the same text as a missing one, then runs the
    /// screen's own action (<see cref="Screen{T}"/>), whose guards and business rules apply as on the
    /// screen: a filed bill cannot be deleted, a billed challan cannot be cancelled, and so on.
    /// </summary>
    public partial class McpController
    {
        private static readonly string[] DeleteKinds =
        {
            "quote", "sales_order", "challan", "bill", "purchase_bill", "goods_receipt", "receipt", "payment", "journal_entry",
            "withholding_receipt", "gd", "lc", "opening_stock", "client", "supplier", "item_type",
        };

        private sealed record Owned(int? CompanyId, int? DivisionId, string Label, bool CompanyLevel);

        /// <summary>The stored company, division and a label of a record, by kind. Null company = no such record.</summary>
        private async Task<Owned?> OwnerAsync(string kind, int id)
        {
            var c = _context;
            return kind switch
            {
                "quote" => await c.SalesQuotes.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, x.DivisionId, "quotation #" + x.QuoteNumber, false)).FirstOrDefaultAsync(),
                "sales_order" => await c.SalesOrders.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, x.DivisionId, "sales order #" + x.SalesOrderNumber, false)).FirstOrDefaultAsync(),
                "challan" => await c.DeliveryChallans.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, x.DivisionId, "challan #" + x.ChallanNumber, false)).FirstOrDefaultAsync(),
                "bill" => await c.Invoices.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, x.DivisionId, "bill #" + x.InvoiceNumber, false)).FirstOrDefaultAsync(),
                "purchase_bill" => await c.PurchaseBills.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, x.DivisionId, "purchase bill #" + x.PurchaseBillNumber, false)).FirstOrDefaultAsync(),
                "goods_receipt" => await c.GoodsReceipts.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, x.DivisionId, "goods receipt #" + x.GoodsReceiptNumber, false)).FirstOrDefaultAsync(),
                "receipt" => await c.Payments.AsNoTracking().Where(x => x.Id == id && x.Direction == Models.Accounting.PaymentDirection.Receipt).Select(x => new Owned(x.CompanyId, x.DivisionId, "receipt " + x.Number, false)).FirstOrDefaultAsync(),
                "payment" => await c.Payments.AsNoTracking().Where(x => x.Id == id && x.Direction == Models.Accounting.PaymentDirection.Payment).Select(x => new Owned(x.CompanyId, x.DivisionId, "payment " + x.Number, false)).FirstOrDefaultAsync(),
                "journal_entry" => await c.JournalEntries.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, x.DivisionId, "journal entry " + x.EntryNo, false)).FirstOrDefaultAsync(),
                "withholding_receipt" => await c.WithholdingTaxReceipts.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, x.DivisionId, "withholding receipt #" + x.ReceiptNumber, false)).FirstOrDefaultAsync(),
                "gd" => await c.ImportConsignments.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, null, "GD " + x.GdNumber, true)).FirstOrDefaultAsync(),
                "lc" => await c.ImportLetterOfCredits.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, null, "LC " + x.LcNumber, true)).FirstOrDefaultAsync(),
                "opening_stock" => await c.OpeningStockBalances.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, null, "opening balance of " + x.ItemType!.Name, true)).FirstOrDefaultAsync(),
                "client" => await c.Clients.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, null, "customer " + x.Name, false)).FirstOrDefaultAsync(),
                "supplier" => await c.Suppliers.AsNoTracking().Where(x => x.Id == id).Select(x => new Owned(x.CompanyId, null, "supplier " + x.Name, false)).FirstOrDefaultAsync(),
                _ => throw new ToolError("Unknown kind."),
            };
        }

        /// <summary>Loads the record, refuses another company's, applies the division rule for a write on it.</summary>
        private async Task<Owned> OwnForWriteAsync(int companyId, string kind, int id)
        {
            if (kind == "item_type")
            {
                if (!await ItemTypeMembership.IsVisibleAsync(_context, id, new[] { companyId })) throw new ToolError(Denied);
                var name = await _context.ItemTypes.AsNoTracking().Where(i => i.Id == id).Select(i => i.Name).FirstAsync();
                return new Owned(companyId, null, "item " + name, false);
            }
            var o = await OwnerAsync(kind, id);
            if (o == null || o.CompanyId != companyId) throw new ToolError(Denied);
            if (o.CompanyLevel) await AssertDivisionWriteAsync(companyId, null);
            else if (o.DivisionId != null) await AssertDivisionWriteAsync(companyId, o.DivisionId);
            return o;
        }

        private void AddLifecycleTools(List<Tool> t)
        {
            t.AddRange(new Tool[]
            {
                new("prepare_delete", "Prepare deleting a record: kind is one of " + string.Join(", ", DeleteKinds) + ". The ERP's own rules apply (a filed or paid document, a challan on a bill, stock still held and so on are refused). Deleting cannot be undone. Nothing is deleted until commit_action.",
                    Obj(new { companyId = CompanyProp, kind = new { type = "string", @enum = DeleteKinds }, id = Int(), idempotencyKey = IdemProp }, "companyId", "kind", "id"),
                    Build: BuildDeleteAsync, PerHour: 20, Noun: "deletions"),
                new("prepare_void", "Prepare cancelling a document: kind 'challan' cancels a challan; 'bill' voids a bill that was never filed with FBR; 'bill_fbr_withdrawn' records that a filed bill was withdrawn on FBR's portal (it keeps its number and IRN; give a reason). Nothing changes until commit_action.",
                    Obj(new { companyId = CompanyProp, kind = new { type = "string", @enum = new[] { "challan", "bill", "bill_fbr_withdrawn" } }, id = Int(), reason = Str(500), idempotencyKey = IdemProp }, "companyId", "kind", "id"),
                    Build: BuildVoidAsync, PerHour: 20, Noun: "cancellations"),
                new("prepare_quote_status", "Prepare changing a quotation's status (for example Sent, Accepted, Rejected, Expired) as the Quotations screen allows. Nothing changes until commit_action.",
                    Obj(new { companyId = CompanyProp, quoteId = Int(), status = Str(30), idempotencyKey = IdemProp }, "companyId", "quoteId", "status"),
                    Build: (c, a) => BuildStatusAsync(c, a, quote: true), PerHour: 30, Noun: "quotation status changes"),
                new("prepare_sales_order_status", "Prepare changing a sales order's status (for example Open, Closed, Cancelled) as the Sales Orders screen allows. Nothing changes until commit_action.",
                    Obj(new { companyId = CompanyProp, salesOrderId = Int(), status = Str(30), idempotencyKey = IdemProp }, "companyId", "salesOrderId", "status"),
                    Build: (c, a) => BuildStatusAsync(c, a, quote: false), PerHour: 30, Noun: "sales order status changes"),
                new("prepare_note", "Prepare a credit or debit note against a bill, or a supplementary bill: mode 'reverse' credits the whole bill; 'credit' / 'debit' take lines (invoiceItemId from get_invoice, quantity, optional unitPrice); 'supplementary' bills more of the same lines. A note gets its own number and is not sent to FBR here. Nothing is saved until commit_action.",
                    Obj(new
                    {
                        companyId = CompanyProp, invoiceId = Int(), mode = new { type = "string", @enum = new[] { "reverse", "credit", "debit", "supplementary" } },
                        reason = Str(200), remarks = Str(500), affectsStock = new { type = "boolean" }, date = DateProp, carryChallan = new { type = "boolean" },
                        lines = new { type = "array", maxItems = 200, items = new { type = "object", additionalProperties = false, required = new[] { "invoiceItemId", "quantity" }, properties = new { invoiceItemId = Int(), quantity = new { type = "string" }, unitPrice = MoneyProp } } },
                        idempotencyKey = IdemProp,
                    }, "companyId", "invoiceId", "mode"),
                    Build: BuildNoteAsync, PerHour: 10, Noun: "notes"),
                new("get_fbr_preview", "The exact JSON the ERP would send FBR for a bill, with the pre-checks, WITHOUT sending anything.",
                    Obj(new { companyId = CompanyProp, invoiceId = Int(), scenarioId = Str(10) }, "companyId", "invoiceId"), Read: GetFbrPreviewAsync),
                new("prepare_fbr_submit", "Prepare SUBMITTING a bill to FBR. On commit FBR issues a legal invoice number (IRN) that cannot be undone; run validate_bill_fbr first. The ERP refuses a bill already filed or in flight.",
                    Obj(new { companyId = CompanyProp, invoiceId = Int(), scenarioId = Str(10), idempotencyKey = IdemProp }, "companyId", "invoiceId"),
                    Build: BuildFbrSubmitAsync, PerHour: 20, Noun: "FBR submissions"),
                new("prepare_fbr_reset", "Prepare the recovery for a bill's FBR state: for a bill stuck in an uncertain state, mode 'retry' clears it so it can be submitted again (only once FBR confirms no invoice exists) and 'recordExisting' records the IRN FBR shows; for a bill never sent from here, 'recordManual' records that it was filed by hand on FBR's portal (give manualFbrInvoiceNumber, the number used there; it is then never sent and stays editable). Its goods left stock when it was saved; list in keepInStockHsCodes any HS codes on it whose goods should stay in stock instead (omit to keep the deduction). Never contacts FBR. A reason is required.",
                    Obj(new { companyId = CompanyProp, invoiceId = Int(), mode = new { type = "string", @enum = new[] { "retry", "recordExisting", "recordManual" } }, irn = Str(100), manualFbrInvoiceNumber = Str(100), keepInStockHsCodes = new { type = "array", maxItems = 200, items = Str(20) }, reason = Str(500), idempotencyKey = IdemProp }, "companyId", "invoiceId", "mode", "reason"),
                    Build: BuildFbrResetAsync, PerHour: 10, Noun: "FBR resets"),
                new("prepare_fbr_exclusion", "Prepare marking a bill as not to be filed with FBR (excluded = true), or filable again (false).",
                    Obj(new { companyId = CompanyProp, invoiceId = Int(), excluded = new { type = "boolean" }, idempotencyKey = IdemProp }, "companyId", "invoiceId", "excluded"),
                    Build: BuildFbrExclusionAsync, PerHour: 30, Noun: "FBR exclusion changes"),
                new("get_fbr_log", "FBR communication log for the company: each validate / submit with status and FBR's answer, newest first, or one entry by logId.",
                    Obj(new { companyId = CompanyProp, logId = new { type = "integer", minimum = 1 }, invoiceId = Int(), status = Str(30), page = new { type = "integer", minimum = 1 }, pageSize = new { type = "integer", minimum = 1, maximum = 100 } }, "companyId"),
                    Read: GetFbrLogAsync),
                new("get_fbr_summary", "FBR activity summary for the company over the last hours (default 24).",
                    Obj(new { companyId = CompanyProp, hours = new { type = "integer", minimum = 1, maximum = 720 } }, "companyId"), Read: GetFbrSummaryAsync),
            });
        }

        // ── delete ─────────────────────────────────────────────────────────

        private static readonly Dictionary<string, string> DeleteKeys = new()
        {
            ["quote"] = "salesquotes.manage.delete", ["sales_order"] = "salesorders.manage.delete", ["challan"] = "challans.manage.delete",
            ["bill"] = "bills.manage.delete", ["purchase_bill"] = "purchasebills.manage.delete", ["goods_receipt"] = "goodsreceipts.manage.delete",
            ["receipt"] = "accounting.receipts.delete", ["payment"] = "accounting.payments.delete", ["journal_entry"] = "accounting.journal.delete",
            ["withholding_receipt"] = "withholdingtax.manage.delete", ["gd"] = "importcosting.sheet.run", ["lc"] = "importcosting.lc.manage",
            ["opening_stock"] = "stock.opening.manage", ["client"] = "clients.manage.delete", ["supplier"] = "suppliers.manage.delete",
            ["item_type"] = "itemtypes.manage.delete",
        };

        private async Task<Built> BuildDeleteAsync(int companyId, JsonElement args)
        {
            var kind = OptText(args, "kind", 30) ?? "";
            if (!DeleteKeys.TryGetValue(kind, out var key)) throw new ToolError("kind must be one of " + string.Join(", ", DeleteKinds) + ".");
            await Need(key);
            var id = IdArg(args, "id");
            var o = await OwnForWriteAsync(companyId, kind, id);
            Func<Task<object>> run = kind switch
            {
                "quote" => () => ScreenAsync(() => Screen<SalesQuotesController>().Delete(id)),
                "sales_order" => () => ScreenAsync(() => Screen<SalesOrdersController>().Delete(id)),
                "challan" => () => ScreenAsync(() => Screen<DeliveryChallansController>().Delete(id)),
                "bill" => () => ScreenAsync(() => Screen<InvoicesController>().Delete(id)),
                "purchase_bill" => () => ScreenAsync(() => Screen<PurchaseBillsController>().Delete(id)),
                "goods_receipt" => () => ScreenAsync(() => Screen<GoodsReceiptsController>().Delete(id)),
                "receipt" => () => ScreenAsync(() => Screen<PaymentsController>().DeleteReceipt(id)),
                "payment" => () => ScreenAsync(() => Screen<PaymentsController>().DeletePayment(id)),
                "journal_entry" => () => ScreenAsync(() => Screen<JournalEntriesController>().Delete(id)),
                "withholding_receipt" => () => ScreenAsync(() => Screen<WithholdingTaxReceiptsController>().Delete(id)),
                "gd" => () => ScreenAsync(() => Screen<ImportConsignmentsController>().Delete(id)),
                "lc" => () => ScreenAsync(() => Screen<ImportLcsController>().Delete(id)),
                "opening_stock" => () => ScreenAsync(() => Screen<StockController>().DeleteOpeningBalance(id)),
                "client" => () => ScreenAsync(() => Screen<ClientsController>().DeleteClient(id)),
                "supplier" => () => ScreenAsync(() => Screen<SuppliersController>().Delete(id)),
                _ => () => ScreenAsync(() => Screen<ItemTypesController>().Delete(id)),
            };
            return new Built(new { kind, id, what = o.Label, warning = "Deleting cannot be undone." }, $"Delete {o.Label} in company {companyId}",
                async () =>
                {
                    await run();
                    return ($"Deleted:{kind}:{id}", $"Deleted {o.Label}");
                });
        }

        // ── void / cancel ──────────────────────────────────────────────────

        private async Task<Built> BuildVoidAsync(int companyId, JsonElement args)
        {
            var kind = OptText(args, "kind", 30);
            var id = IdArg(args, "id");
            var reason = OptText(args, "reason", 500) is { Length: > 0 } r ? r : null;
            switch (kind)
            {
                case "challan":
                {
                    await Need("challans.manage.update");
                    var o = await OwnForWriteAsync(companyId, "challan", id);
                    return new Built(new { kind, id, what = o.Label }, $"Cancel {o.Label} in company {companyId}",
                        async () => { await ScreenAsync(() => Screen<DeliveryChallansController>().Cancel(id)); return ($"DeliveryChallan:{id}", $"Cancelled {o.Label}"); });
                }
                case "bill":
                case "bill_fbr_withdrawn":
                {
                    await Need("bills.manage.void");
                    var o = await OwnForWriteAsync(companyId, "bill", id);
                    var withdrawn = kind == "bill_fbr_withdrawn";
                    if (withdrawn && reason == null) throw new ToolError("Give the reason the bill was withdrawn on FBR's portal.");
                    var body = new InvoicesController.CancelBillRequest { Reason = reason };
                    return new Built(new { kind, id, what = o.Label, reason },
                        withdrawn ? $"Record that {o.Label} was withdrawn on FBR's portal, in company {companyId}" : $"Void {o.Label} in company {companyId}",
                        async () =>
                        {
                            if (withdrawn) await ScreenAsync(() => Screen<InvoicesController>().MarkFbrCancelled(id, body));
                            else await ScreenAsync(() => Screen<InvoicesController>().Cancel(id, body));
                            return ($"Invoice:{id}", withdrawn ? $"Recorded {o.Label} as withdrawn at FBR" : $"Voided {o.Label}");
                        });
                }
                default: throw new ToolError("kind must be challan, bill or bill_fbr_withdrawn.");
            }
        }

        // ── quote and order status ─────────────────────────────────────────

        private async Task<Built> BuildStatusAsync(int companyId, JsonElement args, bool quote)
        {
            await Need(quote ? "salesquotes.manage.update" : "salesorders.manage.update");
            var id = IdArg(args, quote ? "quoteId" : "salesOrderId");
            var status = OptText(args, "status", 30) is { Length: > 0 } s ? s : throw new ToolError("status is required.");
            var o = await OwnForWriteAsync(companyId, quote ? "quote" : "sales_order", id);
            var dto = new SetStatusDto { Status = status };
            return new Built(new { id, what = o.Label, status }, $"Set {o.Label} to {status} in company {companyId}",
                async () =>
                {
                    if (quote) await ScreenAsync(() => Screen<SalesQuotesController>().SetStatus(id, dto));
                    else await ScreenAsync(() => Screen<SalesOrdersController>().SetStatus(id, dto));
                    return ($"{(quote ? "SalesQuote" : "SalesOrder")}:{id}", $"{o.Label} is now {status}");
                });
        }

        // ── notes ──────────────────────────────────────────────────────────

        private async Task<Built> BuildNoteAsync(int companyId, JsonElement args)
        {
            await Need("invoices.note.create");
            var bill = await OwnBillAsync(companyId, IdArg(args, "invoiceId"));
            if (bill.DivisionId != null) await AssertDivisionWriteAsync(companyId, bill.DivisionId);
            var mode = OptText(args, "mode", 20);
            var lines = new List<NoteLineDto>();
            if (mode != "reverse")
            {
                var own = bill.Items.Select(i => i.Id).ToHashSet();
                foreach (var l in Items(args, "lines", 1, 200))
                {
                    var itemId = IdArg(l, "invoiceItemId");
                    if (!own.Contains(itemId)) throw new ToolError($"Line {itemId} is not a line of bill #{bill.InvoiceNumber}.");
                    lines.Add(new NoteLineDto { InvoiceItemId = itemId, Quantity = ReqDec(l, "quantity", 0m, 999_999_999m, 4, minInclusive: false), UnitPrice = OptDec(l, "unitPrice", 0m, 999_999_999m, 4) });
                }
            }
            var reason = OptText(args, "reason", 200);
            var remarks = OptText(args, "remarks", 500);
            var date = DateArg(args, "date");
            var preview = new { invoiceId = bill.Id, bill.InvoiceNumber, mode, reason, remarks, date = Ymd(date), lines = lines.Select(l => new { l.InvoiceItemId, l.Quantity, l.UnitPrice }),
                note = "The note's number and totals are worked out by the ERP. Nothing is sent to FBR." };
            Func<Task<object>> run = mode switch
            {
                "reverse" => () => ScreenAsync(() => Screen<InvoicesController>().Reverse(bill.Id, new CreateReversalNoteDto { Reason = reason, Remarks = remarks })),
                "credit" or "debit" => () => ScreenAsync(() => Screen<InvoicesController>().CreateNote(new CreateNoteDto
                {
                    OriginalInvoiceId = bill.Id, DocumentType = mode == "credit" ? 10 : 9, Reason = reason, Remarks = remarks,
                    AffectsStock = OptBool(args, "affectsStock"), Date = date, Lines = lines,
                })),
                "supplementary" => () => ScreenAsync(() => Screen<InvoicesController>().Supplement(bill.Id, new CreateSupplementaryInvoiceDto
                {
                    Lines = lines, CarryChallan = OptBool(args, "carryChallan") ?? true, Reason = reason, Date = date,
                })),
                _ => throw new ToolError("mode must be reverse, credit, debit or supplementary."),
            };
            var what = mode == "supplementary" ? "a supplementary bill" : mode == "reverse" ? "a full credit note" : $"a {mode} note";
            return new Built(preview, $"Raise {what} against bill #{bill.InvoiceNumber} in company {companyId}",
                async () =>
                {
                    var res = await run();
                    var dto = As<InvoiceDto>(res);
                    return ($"Invoice:{dto.Id}", $"Raised {what} #{dto.InvoiceNumber} (id {dto.Id}) against bill #{bill.InvoiceNumber}, total {dto.GrandTotal:0.00} PKR. Not sent to FBR");
                });
        }

        // ── FBR ────────────────────────────────────────────────────────────

        private async Task<object> GetFbrPreviewAsync(JsonElement args)
        {
            await Need("invoices.fbr.preview");
            var companyId = await CompanyArg(args);
            var bill = await OwnBillAsync(companyId, IdArg(args, "invoiceId"));
            return await ScreenAsync(() => Screen<FbrController>().PreviewPayload(bill.Id, OptText(args, "scenarioId", 10) is { Length: > 0 } s ? s : null));
        }

        private async Task<Built> BuildFbrSubmitAsync(int companyId, JsonElement args)
        {
            await Need("invoices.fbr.submit");
            var bill = await OwnBillAsync(companyId, IdArg(args, "invoiceId"));
            if (bill.FbrSubmittedAt != null || !string.IsNullOrEmpty(bill.FbrIRN)) throw new ToolError($"Bill #{bill.InvoiceNumber} is already filed with FBR.");
            var scenario = OptText(args, "scenarioId", 10) is { Length: > 0 } s ? s : null;
            return new Built(new { invoiceId = bill.Id, bill.InvoiceNumber, bill.ClientName, bill.GrandTotal, scenarioId = scenario,
                    warning = "FBR issues a legal invoice number on submit. It cannot be undone; a filed bill can only be withdrawn on FBR's portal within 72 hours." },
                $"SUBMIT bill #{bill.InvoiceNumber} ({bill.GrandTotal:0.00} PKR) to FBR from company {companyId}",
                async () =>
                {
                    var res = await ScreenAsync(() => Screen<FbrController>().SubmitInvoice(bill.Id, scenario));
                    var el = JsonSerializer.SerializeToElement(res);
                    var ok = el.TryGetProperty("success", out var sv) && sv.ValueKind == JsonValueKind.True
                          || el.TryGetProperty("Success", out var sv2) && sv2.ValueKind == JsonValueKind.True;
                    _resultSummary = $"FBR submission of bill #{bill.InvoiceNumber}: {(ok ? "filed" : "rejected")}";
                    return ($"Invoice:{bill.Id}", ok ? $"Bill #{bill.InvoiceNumber} filed with FBR: {JsonSerializer.Serialize(res)}" : $"FBR did not accept bill #{bill.InvoiceNumber}: {JsonSerializer.Serialize(res)}");
                });
        }

        private async Task<Built> BuildFbrResetAsync(int companyId, JsonElement args)
        {
            await Need("invoices.fbr.reset");
            var bill = await OwnBillAsync(companyId, IdArg(args, "invoiceId"));
            var req = new FbrResetSubmissionRequest
            {
                Mode = OptText(args, "mode", 20) ?? "", Irn = OptText(args, "irn", 100), Reason = OptText(args, "reason", 500) ?? "",
                ManualFbrInvoiceNumber = OptText(args, "manualFbrInvoiceNumber", 100),
                KeepInStockHsCodes = args.TryGetProperty("keepInStockHsCodes", out var keep) && keep.ValueKind == JsonValueKind.Array
                    ? keep.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!.Trim()).Where(c => c.Length > 0).Distinct().ToList()
                    : null,
            };
            if (string.IsNullOrWhiteSpace(req.Reason)) throw new ToolError("A reason is required.");
            if (string.Equals(req.Mode, "recordManual", StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(req.ManualFbrInvoiceNumber))
                throw new ToolError("recordManual needs manualFbrInvoiceNumber: the invoice number used on FBR's portal.");
            return new Built(new { invoiceId = bill.Id, bill.InvoiceNumber, bill.FbrStatus, req.Mode, req.Irn, req.ManualFbrInvoiceNumber, keepInStockHsCodes = req.KeepInStockHsCodes ?? new List<string>(), req.Reason }, $"Reset the FBR state of bill #{bill.InvoiceNumber} ({req.Mode}) in company {companyId}",
                async () =>
                {
                    await ScreenAsync(() => Screen<FbrController>().ResetSubmission(bill.Id, req));
                    return ($"Invoice:{bill.Id}", $"FBR state of bill #{bill.InvoiceNumber} reset ({req.Mode})");
                });
        }

        private async Task<Built> BuildFbrExclusionAsync(int companyId, JsonElement args)
        {
            await Need("invoices.fbr.exclude");
            var bill = await OwnBillAsync(companyId, IdArg(args, "invoiceId"));
            var excluded = OptBool(args, "excluded") ?? throw new ToolError("excluded is required.");
            var body = new InvoicesController.SetFbrExcludedRequest { Excluded = excluded };
            return new Built(new { invoiceId = bill.Id, bill.InvoiceNumber, excluded }, $"Mark bill #{bill.InvoiceNumber} as {(excluded ? "not to be filed" : "to be filed")} with FBR in company {companyId}",
                async () =>
                {
                    await ScreenAsync(() => Screen<InvoicesController>().SetFbrExcluded(bill.Id, body));
                    return ($"Invoice:{bill.Id}", $"Bill #{bill.InvoiceNumber} is now {(excluded ? "excluded from" : "included in")} FBR filing");
                });
        }

        private async Task<object> GetFbrLogAsync(JsonElement args)
        {
            await Need("fbrmonitor.view");
            var companyId = await CompanyArg(args);
            var monitor = Screen<FbrMonitorController>();
            if (IntArg(args, "logId") is int logId)
            {
                var one = await ScreenAsync(() => monitor.GetLog(logId));
                if (As<FbrCommunicationLogDto>(one).CompanyId != companyId) throw new ToolError(Denied);
                return one;
            }
            var invoice = OptId(args, "invoiceId");
            if (invoice is int inv) await OwnBillAsync(companyId, inv);
            return await ScreenAsync(() => monitor.GetLogs(IntArg(args, "page") ?? 1, IntArg(args, "pageSize"), companyId, null,
                OptText(args, "status", 30) is { Length: > 0 } st ? st : null, invoice, null, null));
        }

        private async Task<object> GetFbrSummaryAsync(JsonElement args)
        {
            await Need("fbrmonitor.view");
            var companyId = await CompanyArg(args);
            return await ScreenAsync(() => Screen<FbrMonitorController>().GetSummary(companyId, IntArg(args, "hours") ?? 24));
        }
    }
}
