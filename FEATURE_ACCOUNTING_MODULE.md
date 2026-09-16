# Accounting module + Customer Portal for the Trader line

**Status: PLAN APPROVED, NOT STARTED.**
Branch: `feat/accounting-module-trader`, cut from `TraderFbrInvoicingSystem`.

This file is the working plan for a multi-session build. It is a **transient
doc**: when the feature is complete, verified and merged into
`TraderFbrInvoicingSystem`, this file is deleted in the same session that
merges (the durable record is the README `## Changelog` + git history). See
"Closing out" at the end — the branch is deleted too, locally and on origin.

---

## 1. What we are building

A full double-entry accounting module for the **Trader** production line,
plus the **Customer Portal**, reaching the same functional level the importer
line already runs — chart of accounts, general ledger, GL posting from every
document, output/input tax control accounts, receipts and payments, the
accounting reports suite, and the public customer portal.

The importer line is the **reference implementation**, not the source. Nothing
is cherry-picked from it (see §3).

### Scope decisions already taken

| Decision | Detail |
|---|---|
| **No Divisions** | The importer's accounting carries ~63 division references (`PostingService` 29, `AccountingReportService` 21, `AccountingReportsController` 13). The Trader line has no `Division` entity and is not getting one. Reports and postings scope by **company only**, which `ICompanyAccessGuard` already enforces. |
| **Two taxes, not three** | Keep **Withholding tax (s.153)** and **Further tax (s.3(1A))**. **Advance income tax (236G/236H) is out of scope** — do not port `AddInvoiceAdvanceTax`, `AdvanceTaxRates`, the merge-field seeder or the `AdvanceIncomeTaxOnImports` control type. |
| **Both taxes default to None** | Neither tax is charged unless the operator explicitly selects it. The field renders only once selected; a half-filled selection resolves to nothing rather than charging the buyer on a guess. |
| **GL is always on** | Every new company is created with the GL enabled. There is **no enable/disable toggle** — once on, always on, for everyone. Existing companies are backfilled. |
| **Backfill is small** | Production holds 6 companies: 3 real, 3 demo. Invoices have only recently started on the 3 real ones. No batching or dry-run machinery needed — but the backfill must still be **idempotent** and must never double-post. |

### Explicit non-goals

- Divisions, in any form.
- Advance income tax (236G/236H).
- Import consignments / landed costing (`ImportClearing`, `ImportCostingAccountSeeder`) — importer-line features.
- Touching `master`, `customize-solution-for-other` or `feat/importer-ledger-receipts`. This work stays on the Trader line.

---

## 2. Branch strategy

```
TraderFbrInvoicingSystem
        └── feat/accounting-module-trader        ← all work happens here
```

- The branch is **pushed to origin** so other sessions can see progress and
  pick the work up.
- `TraderFbrInvoicingSystem` stays releasable throughout. An urgent production
  fix is made on the Trader branch directly and then **merged forward** into
  this feature branch (`git merge TraderFbrInvoicingSystem`), never the other
  way round, so the feature branch never blocks a hotfix.
- No deploy workflow triggers on this branch name, so pushing it is safe —
  `deploy-trader.yml` fires only on `TraderFbrInvoicingSystem`.

### Closing out — required, do not skip

When the last phase is verified:

1. Merge into the Trader line: `git switch TraderFbrInvoicingSystem && git merge --no-ff feat/accounting-module-trader`.
2. Run the **full** Trader discipline table once more on the merged tip
   (§7), including the stock-reflow hard gate.
3. Append the README `## Changelog` entry and **delete this file** in the
   merge commit or the one immediately after.
4. Push the Trader branch (this is the deploy).
5. Delete the feature branch **both places**:
   `git branch -d feat/accounting-module-trader` and
   `git push origin --delete feat/accounting-module-trader`.
6. Confirm with `git branch -a` that neither a local nor a remote copy
   survives. Per `docs/ENVIRONMENTS.md` only the five long-lived branches may
   remain.

---

## 3. How code gets here — reimplement, never cherry-pick

**Rule: no commit is cherry-picked from the importer line, and no file is
copied that contains a division reference.**

Reasons, in order of weight:

1. **Divisions.** The importer's accounting is division-scoped throughout. A
   copied file brings `AllowedDivisionIds`, `ScopeToDivisions` and
   `DivisionId` columns that have no meaning here and no entity behind them.
2. **Migrations carry a model snapshot.** A migration cherry-picked between
   lines writes a snapshot describing the *other* branch's model. Every
   migration in this plan is **generated on this branch** with
   `dotnet ef migrations add`, exactly as `WidenInvoiceUnitPriceTo12Decimals`
   was on 2026-09-16.
3. **The lines have genuinely diverged** — 62 migrations apart.

So the importer source is **read for its design and its hard-won correctness
notes**, and the equivalent is written here against this branch's models. Where
a file is genuinely division-free and identical in intent (e.g.
`Helpers/PartyOnAccount.cs`), it may be transcribed verbatim — but it is still
reviewed line by line before it lands, and the commit says it was transcribed.

---

## 4. What already exists on the Trader line

Worth knowing before starting — this is not a greenfield build.

**Present:** `Payments`, `PaymentAllocations` tables; `Models/Accounting/Payment.cs`,
`PaymentAllocation.cs`; `PaymentService` (1,626 lines); `PaymentsController`;
`Helpers/PaymentStatusCalculator.cs`; `GoodsReceipt` + service + controller;
`PrintTaxInvoiceDto.BillItems` and the exact-line-total adjustment (shipped
2026-09-16).

**Absent:** `Accounts`, `AccountGroups`, `JournalEntries`, `JournalLines`,
`AccountTransfers`, `BankReconciliation`, `BankStatementImport`,
`CustomerPortal`, `WithholdingTaxReceipt`; every accounting report; the portal;
`Helpers/PartyOnAccount.cs`, `ReceiptAllocationPlanner.cs`,
`PortalTokenLogMasker.cs`, `FurtherTaxCalculator.cs`;
`Middleware/ResolvePortalAttribute.cs`. `Invoice` carries **no** withholding,
further-tax or advance-tax fields.

---

## 5. Migrations (generated here, in this order)

Advance tax and every division migration are deliberately absent.

| # | Migration | Brings |
|---|---|---|
| 1 | `AddChartOfAccounts` | `AccountGroups`, `Accounts`, control types |
| 2 | `AddGeneralLedger` | `JournalEntries`, `JournalLines`, company GL flag + lock date |
| 3 | `AddInvoiceWithholdingTax` | withholding fields on `Invoice` |
| 4 | `AddInvoiceFurtherTax` | further-tax fields on `Invoice` |
| 5 | `AddWithholdingTaxReceipt` | the s.153 receipt entity |
| 6 | `AddItemTypeCompanyGlAccounts` | per-company GL mapping for item types |
| 7 | `AddPaymentAllocationAdjustment` | allocation adjustments on the existing tables |
| 8 | `AddAccountTransfers` | bank/cash transfers |
| 9 | `AddBankReconciliation` + `AddBankStatementImport` + `AddBankReconciledDate` | reconciliation |
| 10 | `AddCustomerPortal` + `AddCustomerPortalDocumentType` | portal tokens and document type |
| 11 | `AddAccountingReportIndexes` + `AddJournalLinePartyIndex` | report performance |

**`ControlType` numbering is copied from the importer even where a value is
unused here** (e.g. 20/21 for import clearing). Renumbering would make any
future comparison between the lines dangerous, and an enum value costs nothing.
Values in use: `AccountsReceivable(1)`, `AccountsPayable(2)`, `Inventory(3)`,
`BankCash(4)`, `Capital(5)`, `RetainedEarnings(6)`, `OutputTax(7)`,
`InputTax(8)`, `WithholdingReceivable(9)`, `WithholdingPayable(10)`,
`Rounding(13)`, `Suspense(14)`, `DiscountAllowed(15)`, `DiscountReceived(16)`,
`BadDebtWriteOff(17)`, `WriteBackIncome(18)`, `FurtherTaxPayable(19)`,
`CustomerAdvances(22)`.

---

## 6. Phases

Each phase ends with its own commit(s) and its own verification (§7). **A phase
is not finished until its verification is green and recorded in the commit
message.** No phase starts before the previous one is green.

### Phase 1 — Chart of accounts (1 session)
`AccountGroup`, `Account`, the control-type mapping, the seeder that gives a
new company a usable chart, `AccountService`, `AccountsController`,
`ChartOfAccountsPage.jsx`, `AccountSelect.jsx`, `BankCashSelect.jsx`.
Permission keys under `accounting.*` in `PermissionCatalog.cs`, **and the
matching section mapping in `permissionSections.js`** — nothing may land in the
role editor's "Other" bucket.

### Phase 2 — General ledger core (1–2 sessions)
`JournalEntry`, `JournalLine`, `GeneralLedgerService`, `JournalEntryService`,
`JournalEntriesController`, `JournalEntriesPage.jsx`. Period close, the
balanced-entry invariant (debits == credits, enforced server-side), and the
**GL-always-on** policy: enabled at company creation, no toggle anywhere in API
or UI. Reversal semantics for a voided document.

### Phase 3 — Posting from documents (2 sessions) — *the highest-risk phase*
`PostingService`, division-free. Legs for: sales invoice / bill (revenue, A/R,
**output tax**), purchase bill (**input tax**, A/P), receipts and payments,
credit/debit notes, goods receipts, withholding, further tax.

Two traps to design around from the start, both learned the hard way on the
importer line:

- **Further tax is inside `GrandTotal`.** The sale must be derived as
  `GrandTotal − GSTAmount − FurtherTaxAmount`. Miss the subtraction and the tax
  posts to **Sales as revenue** — the books still balance and the income
  statement is quietly wrong, which is the worst shape a bug can take here. It
  posts to its own liability account, `FurtherTaxPayable`.
- **Withholding is deducted by the buyer, not added.** It never moves
  `GrandTotal`; it changes what is collectible.

Both taxes **default to None** and are only charged on an explicit, complete
selection. The resolved rate is stored on the invoice so a document keeps the
rate it was issued at.

### Phase 4 — Accounting reports (2 sessions)
`AccountingReportService` and its partials (Parties, CashBank, Expenses,
Statements, TaxControl, Documents, SalesDetail — ~5,400 lines on the importer,
less here without divisions), `AccountingReportsController`,
`AccountingReportsPage.jsx`, `AccountingDashboardPage.jsx`,
`ClientLedgerReportPage.jsx`, `CustomerLedgerPage.jsx`, the Excel export.

**A report never grows its own accounting calculation** — it reads
`JournalLines` and reuses `GeneralLedgerService`'s primitives. Report scope
comes from the controller, never widened by the caller.

### Phase 5 — Customer Portal (1–2 sessions)
`CustomerPortal`, `CustomerPortalService`, `CustomerPortalsController`,
`PublicCustomerPortalController`, `ResolvePortalAttribute`,
`PortalTokenLogMasker`, `CustomerPortalsPage.jsx`, `PublicPortalPage.jsx`.

This is the **only anonymous surface** in the repo and there is no global
fallback authorization policy, so `[AllowAnonymous]` is carried explicitly with
its reasoning in a header comment. Non-negotiables:

- No tenant guard works here — every guard takes a `userId`, and the seed admin
  is granted everything unconditionally. **Never synthesise a user id.** Scope
  comes from the resolved token, and every query filters on **both** CompanyId
  and ClientId.
- No public method takes a company, client or invoice id from the caller; the
  route carries the document **number**, resolved inside the portal's scope.
- **One generic 404 for every token failure** — unknown, malformed, disabled,
  revoked. `GlobalExceptionMiddleware` echoes 4xx messages verbatim, so distinct
  wording is an enumeration oracle.
- The token is a bearer secret: in `SensitiveDataRedactor`, masked from Serilog,
  masked in audit rows, never logged.

### Phase 6 — GL always-on + backfill (1 session)
Company creation enables the GL; the toggle is removed from API, service and
UI. A one-shot idempotent backfill posts existing companies' history, marked
complete in an `AuditLog` row (`ExceptionType = 'GL_BACKFILL_V1'`) so a rerun
is a no-op. Must not double-post; must balance; must be safe on a company that
already has entries.

### Phase 7 — Verification sweep and merge (1–2 sessions)
Full discipline table on the merged tip, changelog, doc deletion, branch
deletion (§2).

**Estimate: 9–12 sessions.**

---

## 7. Verification — after every phase, without exception

Each phase runs **its own new suite plus the full existing Trader table**. The
existing table is non-negotiable because accounting posts from documents, so a
posting change can break stock, invoicing or FBR without touching their code.

**Existing Trader table (every phase):**

| Check | Command | Must show |
|---|---|---|
| Backend build | `dotnet build MyApp.Api.csproj` | `0 Error(s)` |
| Frontend build | `npm run build --prefix myapp-frontend` | built, no errors |
| **Stock item-type reflow — HARD GATE** | `python scripts/test_stock_itemtype_reflow.py --base <url>` | `161/161` |
| Basic flows | `python scripts/test_basic_flows.py --base <url>` | `37/37` |
| Tenant isolation | `MYAPP_BASE=<url> python scripts/test_tenant_isolation.py` | all passed |
| Exact line total | `python scripts/test_invoice_exact_line_total.py --base <url>` | `69/69` |
| FBR cancellation | `python scripts/test_fbr_cancellation.py --base <url> --db "<conn>"` | `26/26` |
| Unreadable FBR token | `python scripts/test_fbr_token_unreadable_survives_save.py --base <url> --db "<conn>"` | `22/22` |
| Audit verifier | `python scripts/verify_audit_2026_05_13_security.py` | `67/67` |
| PDF pagination | `python scripts/test_pdf_pagination.py` | all passed |
| Permission sections | `python scripts/verify_permission_sections.py` | all mapped |
| No production identifiers | `python scripts/verify_no_production_identifiers.py` | clean |

**New suites, written in the phase that introduces the behaviour** (ported in
spirit from the importer's, with every division case removed):

| Phase | Suite | Pins |
|---|---|---|
| 1 | `test_accounting_chart.py` | seeding, control-type uniqueness, tenant scoping, permission gates |
| 2 | `test_accounting_gl.py` | debits == credits on every entry, period close, reversal, no toggle exists |
| 3 | `test_accounting_posting.py` | every document type's legs; **further tax is a liability, never revenue**; withholding never moves `GrandTotal`; both taxes default to None |
| 4 | `test_accounting_reports.py` | **cross-checks**: expense total vs trial balance, cash-book closing vs CoA balance, register totals vs dashboard |
| 5 | `test_customer_portal.py` | the IDOR suite — the only automated proof the hand-rolled scope holds |
| 6 | `test_gl_backfill.py` | idempotent, balanced, no double-post, safe on an already-posted company |

**Why the reports suite is built out of cross-checks:** a reporting bug shows up
as a *plausible wrong number*, not a crash. Asserting a report against a figure
the engine computes a different way is the only thing that catches it.

Suites create their own throwaway company and **delete it**, following
`test_invoice_exact_line_total.py`. `ItemType` is a global catalog, so any item
type a suite creates is named uniquely per run and deleted in cleanup.

---

## 8. Coding standards this work must follow

From `CLAUDE.md`, the ones this feature will actually brush against:

- **Tenant isolation is mandatory.** Every endpoint taking a `companyId`
  asserts with `_access.AssertAccessAsync`; list endpoints scope to
  `GetAccessibleCompanyIdsAsync`. Never trust `dto.CompanyId` — load the entity
  and assert against its stored `CompanyId`.
- **Every action carries `[HasPermission(...)]`**, reads included. New keys go
  in `PermissionCatalog.cs` **and** `permissionSections.js` in the same change.
- **Buttons the user cannot activate must not render.** Use `usePermissions` /
  `<Can>`.
- **Reuse what exists.** `AccountSelect` / `BankCashSelect` for pickers,
  `LineItemsEditor` for any line-item grid, `formStyles` from `theme.js` for
  modals, the existing `QuantityInput`, the shared `dropdownStyles`. Do not
  write a second component that does an existing one's job.
- **Mobile-first**: `repeat(auto-fit, minmax(min(220px, 100%), 1fr))`, tested at
  375 / 768 / 1280, no horizontal page scroll on a phone; wide tables get a card
  view. Icon buttons `display:grid; placeItems:center` with explicit size, tap
  targets ≥ 44px. Never `nowrap` + `ellipsis` on user-supplied names.
- **Money**: `decimal`, never floating point. `LineTotal`-style money columns
  stay `decimal(18,2)`; only rates carry more scale.
- **Multi-step writes** use `BeginTransactionAsync` with explicit commit/rollback.
- **Never return `ex.Message`** to the client — log it, return a generic message.
- **Excel/CSV exports** route operator strings through `CsvSafe`.
- **EF**: `.AsNoTracking()` on reads; never two concurrent `AppDbContext`
  operations; a single SQL batch may not both add a column and reference it.
- **Never name a production database, host or credential in a tracked file.**

Architecture: controller → service → repository. Business rules live in the
service; the controller does authorization, model binding and HTTP. One place
per rule — the importer's discipline of "there is exactly ONE place X is
computed" is the pattern to copy (e.g. one posting service, one GL primitive
set, one tax calculator per tax).

---

## 9. Risks, and what we do about them

| Risk | Mitigation |
|---|---|
| **Further tax posted as revenue** (books balance, income statement wrong) | Derive the sale by subtraction; dedicated `FurtherTaxPayable` account; a Phase-3 test that spins up a GL company purely to prove the tax is not revenue |
| **Portal IDOR** — the only anonymous surface | Scope from the resolved token only; both CompanyId and ClientId on every query; one generic 404; the IDOR suite is a merge blocker |
| **Backfill double-posts** | Idempotent, marked in `AuditLog`, safe on an already-posted company, verified by its own suite |
| **Division references leak in** | No cherry-picks; a grep for `Division` across the diff is part of every phase's verification |
| **Feature branch drifts from Trader** | Merge Trader forward into the feature branch after every hotfix |
| **13+ migrations reach Production #4** | Staged: the merge to Trader is one reviewed push; migrations are additive and each is reviewed before it lands |
| **Branch left behind** | §2 closing-out checklist, confirmed with `git branch -a` |

---

## 10. Progress log

Append one line per session so a later session can resume without re-reading
the code.

| Date | Phase | State |
|---|---|---|
| 2026-09-16 | — | Plan written and committed. Nothing implemented yet. |
| 2026-09-16 | 1 | **Chart of accounts DONE.** `AccountGroups` + `Accounts` (migration `20260916170348_AddChartOfAccounts`), `AccountService`, `AccountsController`, `CoaPresetSeeder`, `accounting.coa.view` / `accounting.coa.manage`, `ChartOfAccountsPage.jsx`, `AccountSelect.jsx`, `BankCashSelect.jsx`. New suite `test_accounting_chart.py` 103/103; whole existing Trader table green (stock reflow 161/161). Also fixed: `CompanyService.DeleteAsync` did not cascade payments or the chart, so a company with either was undeletable. |

| 2026-09-16 | 2 | **General ledger core DONE.** `JournalEntry` + `JournalLine`, `Company.GlPostingEnabled` / `GlLockDate` (migration `AddGeneralLedger`), `GeneralLedgerService` (the one place an entry is written, plus balances / account ledger / trial balance), `JournalEntryService`, `AccountingController`, `JournalEntriesController`, `JournalEntriesPage.jsx`, `AccountLedgerDialog.jsx`, period close on the CoA screen. GL is on at company creation with no route to turn it off. New suite `test_accounting_gl.py` 93/93; whole existing Trader table green (stock reflow 161/161, chart 103/103). **The suite caught a real bug on its first run:** the manual-journal EDIT path replaced lines in place without going through `WriteEntryAsync`, so an unbalanced edit was accepted and the ledger went out of balance — the invariant is now `AssertEntryIsLegalAsync` on the GL service and both paths call it. |

| 2026-09-16 | 3a | **The two taxes DONE.** `FurtherTaxRate/Amount` + `WithholdingTaxRate/Amount` on `Invoice`, `WithholdingTaxRate/Amount` on `PurchaseBill` (migration `AddWithholdingAndFurtherTax`), `FurtherTaxCalculator`, `WithholdingTaxCalculator`, `DocumentTaxFields.jsx` wired into the bill create, bill edit and purchase-bill forms. Both default to NONE and the field does not exist on the form until added. New suite `test_document_taxes.py` 67/67; whole Trader table green. **Deviations from §5:** migrations 3 and 4 are ONE migration — they always ship together and two would add nothing. |

### Notes for the next session

- **This branch is not in `local.databases.json`.** It is mapped to
  `MyApp_Trader_Local` through the gitignored `local.databases.local.json`, so
  the shared map stays identical on every branch. A fresh checkout needs that
  file (or the branch renamed) or the app falls through to the appsettings
  chain and `DevelopmentSqlGuard` stops it. `run-local.ps1` (untracked) also
  carries an entry for the branch on port 5104.
- `test_fbr_token_unreadable_survives_save.py` is listed in §7 but **does not
  exist on this line** — it is an importer suite. Everything else in the table
  ran.
- Phase 2 picks up where `AccountService.LiveBalance` is marked: that is the one
  place a balance is computed, and journal movement is added on top of it there.
