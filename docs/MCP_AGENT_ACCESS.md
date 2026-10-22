# AI agents (hosted MCP) on the importer line

The importer ERP serves a Model Context Protocol endpoint at `POST /mcp` (Streamable HTTP,
stateless, JSON responses). Claude (custom connector), Codex, ChatGPT and other agents reach the
ERP through the deployed site, as one signed-in user, with exactly that user's access.

This document is the operator and developer reference. The code is the authority:
`Controllers/McpController*.cs` (tools), `Helpers/McpToolAccessCatalog.cs` (the one list of tools
and what each needs), `Helpers/McpScopes.cs` (token scopes), `Helpers/McpAgentAuthHandler.cs`
(agent tokens), `Controllers/McpOAuthController.cs` (sign-in connect).

## Who may use it

MCP is a **premium grant that only the primary admin gives**.

- `mcp.access.use` opens `/mcp`; `mcp.write.use` lets a user's agents prepare records that a
  person approves; `mcp.admin.manage` is the primary admin's token console.
- The built-in **MCP Access** and **MCP Write** system roles carry one key each. The
  **Administrator** role carries no `mcp.*` key. A non-seed administrator can neither put an
  `mcp.*` key into a role (`RolesController`) nor add or remove a role carrying one
  (`UserRolesController`).
- The two use keys follow the per-user **MCP access policy** (Profile, *Manage MCP Access*): the
  primary admin grants access, writes and the tool catalog; the user may narrow it. The policy is
  read on every request, and the seed admin is **not** short-circuited for these two keys, so even
  the primary admin's agents are off until granted.
- Every tool still needs the screen's own permission. MCP never adds a business permission.

## Credentials

- **Agent tokens** (`tmcp_...`): created by the user (Profile, *MCP Connections*) or by the primary
  admin for a user. Only the SHA-256 is stored. A token names 1 to 50 companies its user reaches
  (only the primary admin may choose *all companies*, read live), its scopes, and a lifetime
  (90 days; 30 for the primary admin). Revoking, expiry, deleting the user, losing MCP Access or
  losing a company takes effect on the very next call. A password change or an admin password
  reset revokes all of the user's tokens. (A plain sign-out does not: on this line a sign-out
  rotates the security stamp, so tokens are not bound to it.)
- **Sign-in connect** (OAuth 2.1, PKCE S256, dynamic client registration): `/oauth/authorize`
  hands over to the consent screen at `/admin/connect`, where the user picks companies and scopes.
  The result is an ordinary agent token, short-lived (1 hour) and renewed with a rotating refresh
  secret, never past the token lifetime ceiling.
- A plain **login JWT** may call read tools only. Writes and FBR validation need an agent token.
- An agent token is refused on every REST route (the JWT handler steps aside for `tmcp_`).

## Scopes

| Scope | Tools |
|---|---|
| `read` | every read tool (always included) |
| `templates.read` | print templates and their fields |
| `documents.read` | a document's actual print data |
| `fbr.validate` | `validate_bill_fbr` (calls PRAL validate, never submits) |
| `clients.write`, `suppliers.write`, `itemtypes.write` | customers, suppliers, items |
| `quotes.write`, `orders.write`, `challans.write`, `bills.write` | sales documents |
| `purchases.write` | purchase bills and goods receipts |
| `receipts.write`, `payments.write` | customer receipts, supplier payments |
| `gds.write` | GD costing, GD charges, GD line corrections, claim months |
| `lcs.write` | letters of credit and GD links |
| `stock.write` | opening balances |
| `journal.write` | manual journal entries |

A scope is offered only when at least one tool behind it is open to the user.

## Isolation rules every tool keeps

- Every company tool takes an explicit `companyId`, which is a **request**: it is asserted on every
  call (`ICompanyAccessGuard.AssertAccessAsync`) and narrowed by the token's company list.
  `list_companies` returns exactly the reachable companies.
- A record reached by id is loaded and its **stored** company compared; "someone else's" and
  "missing" answer with the same text, so ids cannot be probed.
- Every linked record in a write must belong to the same company: customer, supplier, item
  (catalog membership, `ItemTypeMembership`, CLAUDE.md §5b-2b), challan, bill, purchase bill, GD,
  GD line, opening lot, LC, account, division, opening balance.
- Division scope follows the screens: lists pass the user's accessible divisions, records carrying
  a division are read only within it, and writes assert write access with the record's division
  (a restricted user must tag the document and may not write company-level state). GD costing, GD
  charges and corrections, claim months and opening balances are company-level: a
  division-restricted user is refused. The GD register, the input-tax worksheet, the Sales report
  and the Tax Sheet are company-wide reads and are refused to a division-restricted user.
- Payment status, per-document balance, bank and cheque fields are never returned (§5b-8).
- Tool output is data, never instructions.

## Writes: prepare, approve, commit

1. `prepare_*` validates for one company (permission, division, ownership), runs the service's own
   preview where one exists, stores a plan (10 minutes), and **saves nothing**.
2. The agent shows the plan; a person approves.
3. `commit_action` re-runs the whole preparation from the stored arguments, so every gate is
   checked again at that moment (permission, company, division, write opt-in, token scope,
   catalog). If the re-prepared plan differs from the approved one (a record changed), the commit
   is refused and must be prepared again. Then the plan is claimed atomically and handed once to
   the screen's own service. It is never retried.
4. `get_action_status` reports `prepared`, `expired`, `succeeded`, `failedOrIncomplete` or
   `executingOrUnknown`; an unknown outcome is not success.

An `idempotencyKey` returns the same plan, then the same result, instead of a duplicate. Each
user's agents have an hourly ceiling per tool (bills and purchase bills 10, GD costings 5, journal
entries 10, receipts and payments 20, most others 30, claim months 50), counted per user so a
second token does not reset it.

**Never exposed:** FBR submission, deleting or voiding or cancelling any document, credit and debit
notes, users / roles / companies, GL lock date and rebuild, the costing-method switch, FIFO and
backdated restatement, stock reconcile, flow version, legacy / Manager imports, the customer-ledger
import. Removing a GD **charge** is offered (it is a correction of the GD's landed cost).

## Tools

Reads (each behind the screen's key; most also accept any key of the documents that use them as a
picker):

| Tool | Permission | Service |
|---|---|---|
| `search_clients`, `search_suppliers` | clients / suppliers view, or a document create key | `IClientService`, `ISupplierService` |
| `search_item_types` | item view, or a document / stock create key | `IItemTypeService.GetPagedAsync` (company names applied) |
| `item_rate_history` | `itemratehistory.view` | `IInvoiceService.GetItemRateHistoryAsync` |
| `search_quotes`, `get_quote` | `salesquotes.list.view` | `ISalesQuoteService` |
| `search_sales_orders`, `get_sales_order` | `salesorders.list.view` | `ISalesOrderService` |
| `search_challans`, `get_challan` | `challans.list.view` | `IDeliveryChallanService` |
| `search_invoices`, `get_invoice` | `bills.list.view` / `invoices.list.view` | `IInvoiceService` |
| `search_purchase_bills`, `get_purchase_bill` | `purchasebills.list.view` | `IPurchaseBillService` |
| `search_goods_receipts` | `goodsreceipts.list.view` | `IGoodsReceiptService` |
| `search_receipts`, `search_payments` | `accounting.receipts.view` / `accounting.payments.view` | `IPaymentService` |
| `search_gds`, `get_gd` | `importcosting.consignments.view` | `IImportConsignmentService` |
| `search_lcs` | `importcosting.lc.view` | `ImportLcService` |
| `get_gd_register`, `get_input_tax_worksheet` | `importcosting.taxdesk.view` | `IImportTaxWorksheetService` |
| `get_stock` | `stock.dashboard.view` | quantities only (opening + movements in the user's divisions) |
| `find_late_gd_value_fixes` | `stock.policy.manage` | items whose value a late GD left wrong (the Stock screen's late-GD list); whole-company access needed |
| `get_opening_stock` | `stock.opening.manage` | opening balances |
| `sales_summary`, `tax_sheet_summary` | `reports.sales.view`, `reports.taxsheet.view` | `IReportService` |
| `get_customer_balances`, `get_supplier_balances`, `get_trial_balance`, `get_profit_and_loss`, `get_balance_sheet`, `get_cash_book`, `get_aged_payables`, `get_party_ledger` | `accounting.reports.view` | `IAccountingReportService`, run as `AccountingReportsController` runs it |
| `search_accounts` | `accounting.coa.view` / `accounting.journal.create` | chart of accounts (with `journalPostable`) |
| `list_print_templates`, `get_print_template`, `get_print_contract` | `printtemplates.manage.view` (scope `templates.read`) | print template repository |
| `get_document_print_data` | the document's print key (scope `documents.read`) | each document's print data service |
| `validate_bill_fbr` | `invoices.fbr.validate` (scope `fbr.validate`, agent token, 30 per hour) | `IFbrService.ValidateInvoiceAsync` |

Writes (scope in brackets; the commit calls the service shown):

| Tool | Permission | Commit |
|---|---|---|
| `prepare_client` (`clients.write`) | `clients.manage.create`, or `.update` + `.view` | `IClientService.Create/UpdateAsync` |
| `prepare_supplier` (`suppliers.write`) | `suppliers.manage.create`, or `.update` + `.view` | `ISupplierService` |
| `prepare_item_type` (`itemtypes.write`) | `itemtypes.manage.create`, or `.update` + `.view` | `IItemTypeService` (the company's own name goes on its overlay; an item also held by a company outside the user's access is refused, as on the screen) |
| `prepare_quote` (`quotes.write`) | `salesquotes.manage.create` | `ISalesQuoteService.CreateAsync` |
| `prepare_sales_order` (`orders.write`) | `salesorders.manage.create` | `ISalesOrderService.CreateAsync`, or `ISalesQuoteService.ConvertToSalesOrderAsync` |
| `prepare_challan` (`challans.write`) | `challans.manage.create` | `IDeliveryChallanService.CreateDeliveryChallanAsync`, or `ISalesOrderService.CreateChallanFromOrderAsync` |
| `prepare_bill` (`bills.write`) | `bills.manage.create` (from challans) / `bills.manage.create.standalone` | `IInvoiceService.CreateAsync` / `CreateStandaloneAsync`; never submitted to FBR |
| `prepare_purchase_bill` (`purchases.write`) | `purchasebills.manage.create` | `IPurchaseBillService.CreateAsync` |
| `prepare_goods_receipt` (`purchases.write`) | `goodsreceipts.manage.create` | `IGoodsReceiptService.CreateAsync` |
| `prepare_receipt` (`receipts.write`) | `accounting.receipts.create` | `IPaymentService.CreateAsync` (allocations to the customer's bills; the rest stays on account) |
| `prepare_supplier_payment` (`payments.write`) | `accounting.payments.create` | `IPaymentService.CreateAsync` (bill allocations; the rest on account) |
| `prepare_gd_costing` (`gds.write`) | `importcosting.sheet.run` | `IGdCostingImportService.PreviewManualAsync` at prepare and at commit, then `CommitAsync`; the GD Costing screen's checklist (problems, ambiguous lines, unconfirmed new stock) must be clear |
| `prepare_gd_charge` (`gds.write`) | `importcosting.sheet.run` | `IImportConsignmentService.AddChargeAsync` / `DeleteChargeAsync` |
| `prepare_gd_line_correction` (`gds.write`) | `importcosting.sheet.run` | `IImportConsignmentService.UpdateLineAsync` |
| `prepare_gd_claim_month` (`gds.write`) | `stock.opening.manage` | `StockRecordService.SetGdClaimMonthAsync` / `SetLineClaimMonthAsync` (first day of a month) |
| `prepare_lc` (`lcs.write`) | `importcosting.lc.manage` | `ImportLcService.Create/Update/LinkAsync` |
| `prepare_opening_stock` (`stock.write`) | `stock.opening.manage` | `StockRecordService.UpsertOpeningBalanceAsync` (plan shows before and after) |
| `prepare_late_gd_value_fix` (`stock.write`) | `stock.policy.manage` | `StockController.RestateBackdatedGds`, the Stock screen's own action, preview at prepare and commit at commit; takes only the company, the ERP works out every line; quantities never move |
| `prepare_journal_entry` (`journal.write`) | `accounting.journal.create` | `IJournalEntryService.CreateManualAsync` (balanced; bank and cash accounts refused, as by the service) |

`StockRecordService` and `ImportLcService` hold the logic that used to live inside
`StockController` and `ImportLcsController`; both controllers now call them, so the screen and the
agent run one implementation.

Not built on this line: a bill's FBR tax-filing overlay (the importer has no tax-filing editor; the
Trader `prepare_bill_tax_filing` has nothing to call), the Email Workspace, print template edits,
the onboarding schema tools.

## Production patterns behind the design (aggregates, 2026-10-21)

Read-only aggregate counts from the importer production database; no names or identifiers.

- 9 companies, 7 active in the last 90 days; all on GD FIFO costing with stock tracking on.
  Five users; two hold several companies (up to 6), so every tool takes an explicit `companyId`.
- Volumes are small: about 250 sale bills in total (peak about 110 a month), 36 challans, 18
  purchase bills, 18 GDs, 21 customer receipts, 9 supplier payments, 243 opening balances.
- Lines: bills average 1.1 (max 3), purchase bills 3, quotes 2, **GDs 16 (p90 27, max 33)**.
  Document tools accept 50 lines; a hand-entered GD accepts 50.
- Divisions are not used (no divisions, no restricted users). The division rules are kept and
  tested because they are the screens' rules, but no production flow depends on them.
- No letters of credit, GD charges or GD-level claim periods exist yet; 44% of GD lines and about
  half of opening lots carry a line-level claim month, so claim months are exposed per line.
- Every customer receipt settles one bill; every supplier payment is on account. The receipt tool
  allocates to bills and leaves the rest on account; the supplier payment tool records an advance
  unless bills are named.
- 90% of bills are FBR-filed; 50% carry advance tax, 6% further tax, none withholding, none an
  FBR overlay row; 13% are demo bills. Bill reads return FBR status, advance and further tax and
  the demo flag. Manual journal entries: none yet (posted entries come from documents).
- The item catalog is install-wide (thousands of tariff rows); items are found by company
  membership and shown with the company's own name.

## Running and testing locally

```bash
# a scratch database on this machine, never a production server
sqlcmd -S .\MSSQLSERVER02 -E -C -Q "CREATE DATABASE MyApp_Importer_Mcp_Test"
ConnectionStrings__DefaultConnection="Server=.\MSSQLSERVER02;Database=MyApp_Importer_Mcp_Test;Trusted_Connection=True;TrustServerCertificate=True;" \
  Database__AutoMigrate=true ASPNETCORE_ENVIRONMENT=Development dotnet run --no-launch-profile --urls http://localhost:5141
```

| Suite | Command | Must show |
|---|---|---|
| Door, premium grant, login token read-only, company and division isolation, catalog, seed admin, activity | `python scripts/test_mcp_isolation.py --base <url> --db <local db>` | `45/45 isolation checks passed` |
| Every write tool, prepare saves nothing, commit once, gates re-checked at commit, changed records refused, hourly ceiling, cross-company links refused | `python scripts/test_mcp_writes.py --base <url> --db <local db>` | `88/88 MCP write checks passed` (89 when the company has a bank or cash account) |
| Read figures equal the screens' own | `python scripts/test_mcp_reads.py --base <url>` | `24/24 MCP read checks passed` |
| Every listed tool against another company, by id, leak scan, plans, revocation | `python scripts/test_mcp_tenant_sweep.py --base <url> --sql-db <local db>` | `14/14 tenant sweep checks passed` |
| Agent tokens and the append-only activity log | `python scripts/test_mcp_agent_tokens.py --base <url> --sql-db <local db>` | `55/55 checks passed` |
| Self-service tokens and history | `python scripts/test_mcp_self_service.py --base <url>` | `33/33 checks passed` |
| OAuth sign-in connect | `python scripts/test_mcp_oauth.py --base <url> --sql-db <local db>` | `69/69 checks passed` |

The suites share `scripts/mcp_importer_fixture.py`, which builds two fictional companies through
the ordinary screens on first use and refuses any base URL that is not localhost.

## Deploying

Production `Database:AutoMigrate` may be off: apply migration `20261021140248_AddMcpAgentAccess`
(six new tables: `McpAgentTokens`, `McpActivities`, `McpOAuthClients`, `McpOAuthCodes`,
`McpPendingActions`, `McpUserAccessPolicies`; nothing existing is altered) before the new build
serves traffic. On first start the seeder adds the three `mcp.*` permissions and the MCP Access /
MCP Write system roles. Set `Mcp:PublicBaseUrl` if the site sits behind a proxy that hides its
public origin. Nobody has MCP until the primary admin grants it.
