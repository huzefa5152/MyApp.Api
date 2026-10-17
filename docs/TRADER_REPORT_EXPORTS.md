# Trader report exports

Tax Sheet keeps its existing screen and category grouping. Its Excel export
lists each pending original commercial bill line, with **Category for Hscode**,
**Description**, and an intentionally empty **Hscode** column for the consultant.
Current filing groups map back to their original source lines; a stale filing
returns the original lines for review. These are exports only, never imports or
edits to the underlying bill.

Reports > Invoice Sales Detail uses the requested 26-column workbook format.
Its screen uses the shared DataTable as a compact bill register, with inline
original-item details and phone/tablet cards. The report uses page scrolling
rather than nested, capped table regions. Trader's company, period, searchable client, FBR
status and search controls apply immediately, without an Apply button. An
incomplete or backwards custom range does not fetch; superseded requests are
aborted and ignored. Changing company clears its client filter and old report.

The report uses original saved commercial lines, including manual challan
references. It lists cancelled bills with an explicit status, matching Importer.
Saved GST is allocated across the bill's lines with the rounding remainder on
the final line. Further tax and freight appear once per bill. Total includes
freight; GST does not. A workbook cell comment identifies included freight.
Trader has no advance-income-tax charge, so its screen and workbook omit that column. Further tax remains. The rest of the workbook layout is unchanged.
Consultant filing groups do not replace these commercial descriptions or rates.

JSON and Excel share one query/filter implementation. Both new endpoints assert
company access and require their own permissions: `reports.invoicedetail.view`
and `reports.invoicedetail.export`. Grant them to the intended roles; no existing
role is silently widened. No schema migration is required.

Local regression (approved isolated test records only):

```text
py -3.14 scripts/test_trader_report_exports.py --base http://127.0.0.1:5149 --database <isolated-local-db_Test>
```

The suite checks workbooks, commercial descriptions, pending filing sources,
numeric totals, filter refusals, text/formula safety, role permissions, company
boundaries and immediate assignment revocation, then removes its fixtures.
Frontend tests live beside `InvoiceSalesDetailPage.jsx`.
