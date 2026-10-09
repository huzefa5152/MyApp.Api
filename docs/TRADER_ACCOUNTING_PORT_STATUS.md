# Trader accounting port — local review status

Verified on 2026-10-09. Working branch: `TraderFbrInvoicingSystem`.
Customize was used as a read-only reference. No production branch merge,
push or deployment was performed. The reviewed work is prepared for a local commit.

## Scope

| Area | Local implementation | Verification |
| --- | --- | --- |
| Bank and cash accounts | Account management, balances and ledger navigation | Responsive screens and integration checks |
| Internal transfers | Create/edit/delete, voucher printing, attachments and GL posting | Balanced movement, foreign accounts refused, rebuild preserved balances |
| Bank reconciliation | Cleared/pending balances, transactions and locking | Locked flags refuse changes; read-only users cannot mutate |
| Bank statements | CSV import, categorise/ignore, receipt/payment posting | Categorisation cannot create a second payment from the same line |
| Receipts and payments | Inclusive tax and non-cash settlement adjustments | Tax splits into expense/tax/cash; 90 cash plus 10 adjustment settles a 100 bill |
| Purchase debit notes | Supplier return entry, stock movements, GL posting and print/PDF | Create, totals, print data, rebuild, supplier protection and cleanup |
| Journal vouchers | Company-branded print/PDF and template selection | Print API and existing report template tests |
| Detailed report catalogue | Existing built report families, filters, grouping, export and print | 44 report reads and all 48 company-access guards |
| Permissions | New module keys, picker audiences, edition gates and navigation | Assigned-company pickers succeed; foreign company requests and denied mutations/export fail closed |
| Company deletion | Accounting dependants removed inside existing transaction | Integration fixture cleanup succeeds with notes, statements and transfers |

Divisions, Manager.io accounting imports and the separate legacy-data migration
tool are excluded. Source catalogue entries marked planned remain planned;
they are not presented as newly implemented reports. Existing Trader report
routes and calculations remain available separately from the new catalogue.

## Passed checks

| Check | Result |
| --- | --- |
| Backend build | 0 errors; 13 existing warnings on compilation |
| Frontend production build | Passed; existing duplicate-style-key and chunk-size warnings |
| EF model check | No pending model changes |
| New expansion suite | 150 HTTP checks plus balance/format invariants |
| Existing posting suite, API-only | 72/72 |
| Existing posting suite, full assertions | 82/82 with a temporary ODBC adapter replacing unavailable local sqlcmd driver; repository assertions unchanged |
| Existing accounting reports suite | 61/61 |
| Existing stock item-type reflow suite | 250/250 |
| Existing report-print suite | 43 checks, two template inputs and two PDF layouts |
| Tenant-scope static check | 226 company-scoped actions guarded |
| Identifier scan | Tracked files and additional untracked port files clean |
| Diff whitespace check | Passed |
| Screens | No page overflow at 360, 390, 768, 1024, 1366 and 1920 pixels |
| Modals | Debit-note, reconciliation, statement and transfer dialogs fit those viewports; keyboard focus checks pass |

Repeatable new API suite:

```powershell
python scripts/test_trader_accounting_expansion.py --base http://127.0.0.1:5274
```

Run this only against the approved disposable local test database. It creates
its own companies, tenant-scoped user and role, then removes its fixtures.
The local preview is `http://127.0.0.1:5275/`, with its proxy targeting the
isolated test API. Preview data is synthetic, not a restored production dataset.

## Final verification and deployment readiness

The reviewed fixture updates copy private roles into each test user's tenant,
assert setup succeeds, and clean up the copied roles. Existing accounting and
permission assertions remain intact. Edition expectations now include transfers
and reconciliation, preserving the Sales/Complete boundary.

- Chart suite: 105/105 passed.
- General ledger suite: 99/99 passed.
- Edition suite: 114/114 passed in an independent run after the login limiter reset.
- Upgrade: restored the existing local Trader database into a disposable copy;
  applied the expansion migration and verified all 64 existing table row counts,
  invoice totals and journal debit/credit totals remained unchanged.
- SQL integrity check passed; a second migration run applied nothing.

Deployment requires a current backup and persistent DataProtection keys. Apply
`20261009121316_AddTraderAccountingExpansion` before serving the updated build
if automatic migrations are disabled. Verify assigned-company navigation,
Complete Edition permissions, account balances and one receipt/payment workflow
after deployment. Divisions and excluded import tools must remain absent.

Production deployment and production-scale upgrade duration remain unverified.
No production database was modified; no push or deployment was performed.
