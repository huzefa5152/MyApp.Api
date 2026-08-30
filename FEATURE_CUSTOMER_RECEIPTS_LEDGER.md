# Customer Receipts & Customer Ledger — design

**Status:** DESIGN ONLY — approved scope, not started.
**Branch:** `feat/importer-ledger-receipts`
**Date:** 2026-08-29

---

## 1. Problem

A receipt today cannot exist without an invoice. `PaymentService.CreateAsync`
rejects any payment with no allocation lines:

```
Services/Implementations/PaymentService.cs:78
    "A payment needs at least one allocation line."
```

That single rule forces the operator to pick invoices at the moment cash
arrives. Real trading does not work that way: a customer owing PKR 1,000,000
sends 100,000, then 200,000, then 5,000,000, and nobody decides at the counter
which invoice each tranche belongs to. When the payment exceeds the outstanding
balance the system has no place to put the excess at all.

There is also no customer ledger. `ClientService.GetStatementAsync` is the
closest thing and it is materially wrong (§6).

## 2. Goals

- Record a receipt against a **customer**, with no invoice selected.
- One receipt may be partly allocated and partly not.
- Excess cash becomes a **customer advance**, spendable against future invoices.
- A **customer ledger** showing invoices, receipts, notes, adjustments and
  opening balance chronologically, with a running balance.
- A ledger screen listing **all** customers with aggregate figures per row,
  expanding in place to that customer's entries.

## 3. Non-goals

- **No supplier equivalent.** Suppliers stay purchase-bill-only. Money-out
  (`PaymentDirection.Payment`) is untouched by this work; every rule below is
  gated on `Direction == Receipt`.
- No new nav entry for receipts — the Receipts screen already exists.
- No change to FBR submission. Receipts are internal AR and never reach PRAL.

## 4. Architecture

### 4.1 Extend `Payment`, do not add a parallel document

`Models/Accounting/Payment.cs` already carries direction, contact
(Client/Supplier/Other), method, cheque/PDC lifecycle, cancellation, division
and the GL hooks. `PaymentAllocation` already spreads one payment across many
invoices with a settle-remainder adjustment. A second "CustomerReceipt" entity
would duplicate all of it and split the AR truth across two tables.

Three changes:

1. **`Payment.Amount` becomes the source of truth.** Today it is derived —
   `Amount = dto.Allocations.Sum(a => a.Amount)` (`PaymentService.cs:237`). It
   becomes a caller-supplied field, with the invariant:

   ```
   Σ allocation.(Amount + AdjustmentAmount)  ≤  Payment.Amount
   ```

2. **Allocations become optional** when `Direction == Receipt` and
   `ContactType == "Client"` with a non-null `ContactId`. Zero allocations is a
   fully-unapplied receipt. Every other shape keeps the existing rule — a
   money-out `Payment`, or a receipt with `ContactType == "Other"`, still
   requires at least one line, because without a party there is no account for
   an unapplied balance to live on.

3. **Unallocated amount** is derived, never stored — **cash only**:

   ```
   unallocated(payment) = Amount − Σ allocation.Amount
   ```

   **No `AdjustmentAmount` term** (corrected 2026-08-30, after the Task 2
   review). An adjustment is a non-cash write-off that already carries its own
   Dr leg in `PostPaymentAsync`; subtracting it here understates the unassigned
   cash and silently pushes the difference onto the Suspense plug. Two distinct
   quantities, easily conflated:

   | | expression | used by |
   |---|---|---|
   | settled against the **invoice** | `Amount + AdjustmentAmount` | over-pay guard, `Invoice.AmountPaid` |
   | spent from the **receipt** | `Amount` | advance leg, customer advance, receipt invariant |

   Worked example — receipt cash 1000, allocation of 500 cash + 100 written off:
   Dr Bank 1000, Dr Adjustment 100, Cr AR 600, Cr Advances **500** → 1100 = 1100.
   The conflated form gives 400 and leaves 100 in Suspense. It also breaks the
   invariant: a 1000-cash receipt clearing an 1100 invoice via a 100 write-off
   is legitimate, and `Σ(Amount + AdjustmentAmount) ≤ Amount` would reject it.

### 4.2 The ledger is derived, never persisted

No `CustomerLedgerEntry` table. A new `CustomerLedgerService` composes the
ledger at read time from live documents, exactly as `InventoryReadService`
composes stock buckets. `CLAUDE.md` already states the reasoning for that
choice: a derived read model cannot drift from its sources.

Customer aggregates follow from the same query:

```
outstanding = Σ open invoice balances        (invoices, less allocations)
advance     = Σ unallocated receipts         (non-cancelled, this client)
net balance = outstanding − advance
```

`advance` is the "available credit" of the requirement — one number, not two.

### 4.3 Grouping

Aggregates group by `Client.ClientGroupId ?? -ClientId`, matching
`DashboardService.ComputeSalesAsync`. The same legal entity trading under two
tenant records must show one balance, not two.

## 5. What must not break

- **`Invoice.AmountPaid` stays allocation-driven.** It is recomputed as
  `Σ (Amount + AdjustmentAmount)` over allocations (`PaymentService.cs:523`) and
  feeds `PaymentStatusCalculator`. An unallocated receipt must contribute
  nothing to it. This falls out of the design — stated explicitly because it is
  the thing a naive implementation gets wrong, and getting it wrong misreports
  the payment status of every invoice on the system.
- **Keep the per-invoice over-pay guard** (`PaymentService.cs:193`). An
  *allocation* still may not exceed an invoice's balance. Only the *receipt
  total* may exceed the customer's outstanding. Two different rules at two
  different levels; the existing one stays exactly as it is.
- **Cancellation.** A cancelled receipt contributes neither payment nor advance.
  `IsCancelled` already excludes it from `AmountPaid`; the advance calculation
  must filter identically or a voided receipt leaves a phantom credit.
- **Customer portal.** `PublicCustomerPortalController` shows a customer their
  outstanding. Once advances exist, a customer with credit must not be shown a
  balance that ignores it. Portal changes go through
  `scripts/test_customer_portal.py` suite 4.

## 6. Fix the existing statement

`ClientService.GetStatementAsync` (`ClientService.cs:487`) is superseded by
`CustomerLedgerService`. Its defects must not be carried forward:

| Defect | Line | Effect |
|---|---|---|
| Credit/debit notes excluded (`DocumentType != 9 && != 10`) | `:494` | Notes never appear on the statement |

**Note-type codes (corrected 2026-08-30, found during Task 5).** An earlier draft
of this document had these inverted. Authoritative per `Invoice.cs:102,151`,
`InvoiceService.cs:2414`, `PostingService.cs:228` and `CompanyService.cs:319/325`:

> **`DocumentType 9 = Debit Note`. `DocumentType 10 = Credit Note`.**

Under the workbook column convention, inverting them is a doubled error — a
credit note would be labelled a debit note *and* printed in the Credit column,
so the statement would overstate the customer's debt by twice each credit note.
| Credits count `a.Amount` only, while `AmountPaid` counts `Amount + AdjustmentAmount` | `:513` | **Any settle-remainder discount makes the closing balance disagree with A/R** |
| Hard `CAP = 200`, newest-first truncation | `:489` | Long-standing customers silently lose history |
| No date range, no opening balance | — | Cannot produce a period statement |

The second row is a live correctness bug today, independent of this feature.

## 7. Data model

No new tables and no new columns. The change is semantic only:

```
Payment.Amount            -- exists; stops being derived, becomes authoritative (§4.1)
PaymentAllocation         -- unchanged
```

Migration: none required for the shape.

**Correction (2026-08-30, found during Task 2).** An earlier draft of this
section claimed every existing payment satisfies `Amount == Σ allocations`, and
that any row failing it is a pre-existing inconsistency. That is wrong.
`ManagerImportService.ImportMoneyAsync` deliberately creates payments where
`Amount` is the header amount and allocations cover only the documents it could
match — it even returns a `(created, unallocated)` tuple and accumulates
`lineUnalloc` (`ManagerImportService.cs:733`). So an unallocated remainder is
already a designed outcome for Manager-imported data.

Two consequences:

1. **`Payment.Amount` is already authoritative for those rows**, so §4.1's
   semantic change is less of a break than it first appeared.
2. **Their GL treatment changes.** Before the advance leg existed, an
   under-allocated payment's imbalance fell to the Suspense fallback. It now
   posts to Advance from Customers — arguably more correct, but a real change,
   not a no-op. It cannot fire on this branch (no such data), but it WOULD fire
   on any tenant with Manager-imported on-account payments and the GL enabled.
   **Check this before cherry-picking the posting change to `master` or
   `customize-solution-for-other`.**

The pre-flight query in the plan is therefore a *census*, not a defect hunt:
run it to learn how many rows are affected, not to find corruption.

## 8. API

| Method | Route | Permission |
|---|---|---|
| `POST` | `/api/receipts/company/{companyId}` (allocations optional) | `accounting.receipts.create` |
| `POST` | `/api/receipts/{id}/allocate` — apply unallocated balance to invoices | `accounting.receipts.create` |
| `GET` | `/api/customer-ledger/company/{companyId}` — all customers, aggregates | `customerledger.list.view` |
| `GET` | `/api/customer-ledger/company/{companyId}/client/{clientId}` — entries, paged, date-filtered | `customerledger.list.view` |

Money-in permissions are `accounting.receipts.*`; `accounting.payments.*` is
money-out and is not used by this feature.

Every route asserts `_access.AssertAccessAsync(CurrentUserId, companyId)` and
resolves the client **within** that company — never trusting a body field.
Paging clamps through `PaginationHelper`. A tenant-isolation case per new
endpoint goes in `scripts/test_tenant_isolation.py`.

## 9. UI

### 9.1 Receipts screen — extended, no new nav entry

`myapp-frontend/src/pages/PaymentsPage.jsx` (`mode="receipts"`) and
`PaymentForm` already exist behind `accounting.payments.view`. Changes:

- Invoice selection becomes optional. A receipt saves with customer, date,
  amount, method, reference, notes and attachments alone.
- When invoices are picked, show live: allocated, unallocated, resulting advance.
- Existing `Receipt` print template path is unchanged.

### 9.2 Customer Ledger — one new nav entry

New page under the Accounting section. One row per customer:

```
Customer | Opening | Invoiced | Received | Outstanding | Advance | Closing
```

Row expands in place to that customer's entries — no navigation, collapse
returns to the list:

```
Date | Reference | Type | Debit | Credit | Balance
```

Filters: date range, transaction type, method, and "has outstanding" /
"has advance". Opening balance → transactions → running balance → closing.

Mobile-first per `CLAUDE.md` §3: `repeat(auto-fit, minmax(min(220px, 100%), 1fr))`,
no `whiteSpace: nowrap` on customer names, tap targets ≥ 44px, verified at
375 / 768 / 1280.

## 10. Permissions

New module `customerledger` in `Helpers/PermissionCatalog.cs`, mapped to the
Accounting section in `myapp-frontend/src/config/permissionSections.js` in the
**same change** — `scripts/verify_permission_sections.py` fails otherwise.
Action buttons render only behind `has(...)`.

## 11. GL posting

GL is on for these companies (§12). An unallocated receipt is **not** a
reduction of Accounts Receivable — the customer owes nothing for it yet. It is a
liability:

```
Receipt, fully unallocated:
  Dr  Bank / Cash              Amount
  Cr  Advance from Customers   Amount

Receipt, partly allocated:
  Dr  Bank / Cash              Amount
  Cr  Accounts Receivable      Σ allocations
  Cr  Advance from Customers   unallocated

Later allocation of an advance to an invoice:
  Dr  Advance from Customers   allocated
  Cr  Accounts Receivable      allocated
```

`Advance from Customers` (current liability) is added to `CoaPresetSeeder` and
back-filled for companies that already have a chart. Posting goes through
`PostingService` — no journal logic is written in the receipts service.

## 12. Company-creation defaults — separate workstream

Independent of the receipts module; recorded here because it was decided in the
same conversation. New companies should default to:

| Setting | Today | Wanted |
|---|---|---|
| GL | off (opt-in via `GeneralLedgerService.EnableAsync`) | **on** |
| `FbrEnabled` | `true` (`Company.cs:71`) | **false** |
| `InventoryFlowVersion` | `1` (`Company.cs:122`) | **2** |
| `IsTenantIsolated` | `false` (`Company.cs:148`) | **true** |

Two caveats:

- **`IsTenantIsolated` is informational only.** Access is already fail-closed
  for every non-seed-admin via `UserCompany` (`CompanyAccessGuard.cs:82`).
  Defaulting it true makes the UI checkbox honest; it grants no protection that
  is not already in force.
- **Turning on V2 defaults `StockGuardHardBlock` on** — see the flow-version
  endpoint. New companies get the hard block; existing tenants are untouched.

Defaults belong in company creation, **not** in the entity initialisers —
Hakimi (1) and Roshan (2) must not shift. Existing companies keep their values.

## 13. Test plan

| Check | Command | Must show |
|---|---|---|
| Backend build | `dotnet build MyApp.Api.csproj` | `0 Error(s)` |
| Tenant isolation | `python scripts/test_tenant_isolation.py` | all PASS |
| Basic flows | `python scripts/test_basic_flows.py` | all PASS |
| Customer portal | `python scripts/test_customer_portal.py` | 94/94 |
| Permission mapping | `python scripts/verify_permission_sections.py` | all mapped |
| Security audit | `python scripts/verify_audit_2026_05_13_security.py` | 67/67 |

New suite `scripts/test_customer_receipts_ledger.py`:

1. Receipt with no allocation → advance rises, **`Invoice.AmountPaid` unchanged
   on every invoice**, payment status unchanged.
2. The 1,000,000 / 100,000 / 200,000 / 5,000,000 sequence → ledger balances
   match the requirement's table, closing at −4,500,000.
3. Partial allocation → allocated portion hits `AmountPaid`, remainder becomes
   advance, and the two sum to `Payment.Amount`.
4. Allocate an advance to a later invoice → advance falls, `AmountPaid` rises,
   ledger stays balanced.
5. Cancel a receipt carrying an advance → advance returns to zero.
6. Over-allocate a single invoice → still rejected (existing guard intact).
7. Settle-remainder discount → **ledger closing balance equals A/R** (the §6 bug).
8. Ledger aggregates group by `ClientGroupId` where set.

## 14. Risks

- **`Payment.Amount` semantics change** is the sharp edge. Everything reading
  that column must be audited before the invariant loosens.
- **Advance is a liability.** Booking it against AR would understate
  receivables and misstate the trial balance.
- **The portal is anonymous.** Any balance shown there must account for
  advances without exposing anything new — re-run suite 4.
