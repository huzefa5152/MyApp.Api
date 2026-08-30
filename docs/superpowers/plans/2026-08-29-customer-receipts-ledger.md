# Customer Receipts & Customer Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a receipt be recorded against a customer with no invoice selected, with any excess becoming a spendable customer advance, and surface every customer's complete money-in/money-out trail in a new Customer Ledger screen.

**Architecture:** Extend the existing `Payment` / `PaymentAllocation` pair rather than adding a parallel receipt document — `Payment.Amount` stops being `Σ allocations` and becomes authoritative, allocations become optional for customer receipts, and `unallocated = Amount − Σ allocation cash` is the advance (cash only — see Global Constraints). The ledger is a derived read model computed from live documents (same call the repo already made for stock buckets in `InventoryReadService`), never a persisted table.

**Tech Stack:** .NET 9, EF Core 9, SQL Server, React 19 + Vite, Python integration tests.

## Global Constraints

- Spec of record: `FEATURE_CUSTOMER_RECEIPTS_LEDGER.md`. Branch: `feat/importer-ledger-receipts`.
- **Money-out is out of scope.** Every rule added here is gated on `Direction == Receipt`. `PaymentDirection.Payment` behaviour must be byte-for-byte unchanged. No supplier ledger.
- **`Invoice.AmountPaid` stays allocation-driven.** An unallocated receipt contributes nothing to it. Breaking this misreports `PaymentStatusCalculator` for every invoice on the system.
- **The existing per-invoice over-pay guard stays** (`PaymentService.cs:193`). An allocation may not exceed an invoice's balance; only the receipt *total* may exceed the customer's outstanding.
- **LEDGER SIGN CONVENTION — decided by the user 2026-08-30: follow the WORKBOOK.**
  - Invoices and debit notes land in the **Credit** column. Receipts, credit notes and adjustments land in the **Debit** column.
  - Running balance = `Opening + Σ Credit − Σ Debit`. A positive balance means the customer owes; negative means they hold an advance.
  - This is the mirror of the standard A/R presentation and of the table in the user's 2026-08-29 written requirement. The workbook (`Alpha Trader Ledger Jul 2025 to Jun 2026.xlsx`) is what their client actually reads, and it wins. Verified against Brothers & Co: opening 355,525 → invoice AA-21 Credit 862,261 → 1,217,786 → Transfer Debit 343,536 → 874,250.
  - **This is PRESENTATION ONLY.** It changes which column an amount is printed in. It does NOT change any GL posting, `Invoice.AmountPaid`, the over-pay guard, or the advance arithmetic. Tasks 5 and 12 both use it; nothing else does.
- **CASH vs SETTLEMENT — two quantities, never conflated** (corrected 2026-08-30, after the Task 2 review caught the original wording):
  - Against the **invoice**, an allocation settles `Amount + AdjustmentAmount` — cash plus the non-cash write-off. Unchanged. The over-pay guard and `Invoice.AmountPaid` both keep using this.
  - Against the **receipt**, only cash counts: `Σ a.Amount`, with **no** `AdjustmentAmount` term. `AdjustmentAmount` is non-cash and already carries its own Dr leg inside `PostPaymentAsync`.
  - So: GL advance leg = `Payment.Amount − Σ a.Amount`; customer advance = the same expression; receipt invariant = `Σ a.Amount ≤ Payment.Amount`.
  - Worked example — receipt cash 1000, one allocation of 500 cash + 100 write-off: Dr Bank 1000, Dr Adjustment 100, Cr AR 600, Cr Advances **500** → 1100 = 1100. Using `Amount + AdjustmentAmount` gives 400 and silently dumps the missing 100 on the Suspense plug.
  - The invariant must use cash too, otherwise a 1000-cash receipt clearing an 1100 invoice via a 100 write-off is wrongly rejected as over-allocated.
- Every endpoint taking `companyId` calls `await _access.AssertAccessAsync(CurrentUserId, companyId)`. Every endpoint carries `[HasPermission(...)]`. Paging clamps via `PaginationHelper`.
- Never return `ex.Message` to the client — `_logger.LogError(ex, "...")` then a generic message.
- Permission module strings go in `Helpers/PermissionCatalog.cs` **and** `myapp-frontend/src/config/permissionSections.js` in the same change; `python scripts/verify_permission_sections.py` fails otherwise.
- Receipts permissions are `accounting.receipts.*` (NOT `accounting.payments.*` — that's money-out).
- Existing companies (Hakimi `CompanyId=1`, Roshan `CompanyId=2`) must not shift behaviour. New defaults apply to newly-created companies only.
- Mobile-first: `repeat(auto-fit, minmax(min(220px, 100%), 1fr))`, no `whiteSpace: "nowrap"` on customer names, tap targets ≥ 44px, verified at 375 / 768 / 1280.
- Commit messages: imperative, ≤72 chars, **no AI attribution / no `Co-Authored-By`**.
- Ask before every commit and every push.

## File Structure

**Create:**
- `Services/Implementations/CustomerLedgerService.cs` — derives ledger entries + per-customer aggregates. Read-only, no writes.
- `Services/Interfaces/ICustomerLedgerService.cs`
- `Controllers/CustomerLedgerController.cs` — two GET endpoints.
- `DTOs/CustomerLedgerDtos.cs` — row, entry, aggregate shapes.
- `myapp-frontend/src/pages/CustomerLedgerPage.jsx` — the new tab.
- `myapp-frontend/src/api/customerLedgerApi.js`
- `scripts/test_customer_receipts_ledger.py` — the benchmark suite.

**Modify:**
- `Models/Accounting/AccountingEnums.cs` — add `ControlType.CustomerAdvances`.
- `Services/Implementations/CoaPresetSeeder.cs` — seed `Advance from Customers`.
- `Services/Implementations/PostingService.cs:58` — advance leg in `PostPaymentAsync`.
- `Services/Implementations/PaymentService.cs:78,193,237` — optional allocations, authoritative `Amount`.
- `DTOs/PaymentDtos.cs:65` — `Amount` on `CreatePaymentDto`.
- `Controllers/PaymentsController.cs` — allocate-later endpoint.
- `Services/Implementations/ClientService.cs:487` — statement delegates to the ledger service.
- `Helpers/PermissionCatalog.cs:136` — `CustomerLedger` module.
- `myapp-frontend/src/config/permissionSections.js` — map it.
- `myapp-frontend/src/layouts/DashboardLayout.jsx:511` — nav entry.
- `myapp-frontend/src/Components/PaymentForm.jsx` — optional invoice.
- `myapp-frontend/src/App.jsx` — route.
- `DTOs/CreateCompanyDto.cs:72` — `IsTenantIsolated = true`.
- `Services/Implementations/CompanyService.cs` — enable GL on create.
- `README.md` — changelog entry.

---

### Task 1: Add the `CustomerAdvances` control account

An unallocated receipt is a **liability** — the customer owes nothing for it yet. Booking it against Accounts Receivable would understate receivables. This task adds the account with no behaviour change; nothing posts to it until Task 3.

**Files:**
- Modify: `Models/Accounting/AccountingEnums.cs:22-41`
- Modify: `Services/Implementations/CoaPresetSeeder.cs:85-88`
- Test: `scripts/test_customer_receipts_ledger.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ControlType.CustomerAdvances = 19`; a seeded account keyed `customer_advances`, named `Advance from Customers`, under the `liabilities` group, `AccountType.Liability`.

- [ ] **Step 1: Add the enum member**

In `Models/Accounting/AccountingEnums.cs`, after `WriteBackIncome = 18` — the
last member, **not** after `Suspense = 14`:

```csharp
        /// <summary>Customer money received but not yet applied to an invoice —
        /// a liability, NOT negative A/R. The customer owes nothing for it yet,
        /// so it must not net against Accounts Receivable. (2026-08-29)</summary>
        CustomerAdvances = 19,
```

**19, not 15.** Values 15-18 are the settle-remainder adjustment accounts
(`DiscountAllowed`, `DiscountReceived`, `BadDebtWriteOff`, `WriteBackIncome`).
C# aliases duplicate enum values with no compile error, and
`PostingService.ResolveAsync` matches on `a.ControlType == role` — so reusing 15
would silently resolve every advance posting to the company's *Discount allowed*
account, moving customer liabilities into P&L with a green build.

- [ ] **Step 2: Seed the account**

In `Services/Implementations/CoaPresetSeeder.cs`, after the `wht_payable` line:

```csharp
            await Account("customer_advances", "Advance from Customers", "liabilities", AccountType.Liability, ControlType.CustomerAdvances);
```

- [ ] **Step 3: Build**

Run: `dotnet build MyApp.Api.csproj`
Expected: `0 Error(s)`

- [ ] **Step 4: Verify the account appears for a fresh chart**

Start the backend, create a throwaway company, seed the preset, then:

Run: `curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5134/api/accounts/company/$CID/tree" | grep -c "Advance from Customers"`
Expected: `1`

- [ ] **Step 5: Back-fill companies that already have a chart**

Existing charts predate the account. Add an idempotent startup back-fill in `Program.cs`, following the `SecurityStamp` pattern already there (`CLAUDE.md` §11 — a batch that both ALTERs and references a new column fails at parse time; this one only inserts, but keep the AuditLog completion marker convention):

```csharp
// One-time: every company with a chart of accounts gains the customer-advance
// control account. Marked complete via an AuditLog row so a restart is a no-op.
await BackfillCustomerAdvanceAccountAsync(app.Services, "CUSTOMER_ADVANCES_BACKFILL_V1");
```

- [ ] **Step 6: Commit**

```bash
git add Models/Accounting/AccountingEnums.cs Services/Implementations/CoaPresetSeeder.cs Program.cs
git commit -m "Add Advance from Customers control account"
```

---

### Task 2: Post the unallocated remainder to the advance account

`PostPaymentAsync` currently debits bank for the full `payment.Amount`, then credits one leg per allocation. The moment `Σ allocations < Amount` that journal is **unbalanced**. This task adds the balancing leg before Task 3 makes that state reachable, so the ledger can never be corrupted in between.

**Files:**
- Modify: `Services/Implementations/PostingService.cs:58-130`

**Interfaces:**
- Consumes: `ControlType.CustomerAdvances` (Task 1).
- Produces: `PostPaymentAsync` emits a `Cr Advance from Customers` line of `payment.Amount − Σ allocations.(Amount + AdjustmentAmount)` when that difference is positive and the payment is a receipt.

- [ ] **Step 1: Add the advance leg**

In `PostPaymentAsync`, after the allocation loop and before the journal is saved:

```csharp
            // Unallocated remainder of a customer receipt — money in hand that
            // settles no invoice yet. A liability, not negative A/R (see
            // ControlType.CustomerAdvances). Without this leg the journal is
            // unbalanced the instant allocations don't cover the full amount.
            // CASH only. AdjustmentAmount is a non-cash write-off that already
            // has its own Dr leg above, so subtracting it here would understate
            // the unassigned cash and silently push the difference onto the
            // Suspense plug. See the two-quantities note in Global Constraints.
            var allocatedCash = payment.Allocations.Sum(a => a.Amount);
            var unallocated = payment.Amount - allocatedCash;
            if (isReceipt && unallocated > 0m)
            {
                var advances = await ResolveAsync(payment.CompanyId, accounts,
                    ControlType.CustomerAdvances, "customer advances");
                AddLine(lines, advances.Id, debit: 0m, credit: unallocated,
                    payment.DivisionId, reference,
                    partyType: payment.ContactType == "Client" ? "Client" : null,
                    partyId: payment.ContactType == "Client" ? payment.ContactId : null);
            }
```

Match the exact `AddLine` signature already used in the file — if it takes positional party args, mirror the allocation-loop call site rather than the named form above.

- [ ] **Step 2: Build**

Run: `dotnet build MyApp.Api.csproj`
Expected: `0 Error(s)`

- [ ] **Step 3: Verify no behaviour change yet**

Unallocated receipts are still rejected, so every existing journal must be identical.

Run: `python scripts/test_basic_flows.py`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add Services/Implementations/PostingService.cs
git commit -m "Post a receipt's unallocated remainder to customer advances"
```

---

### Task 3: Allow customer receipts with no allocation

The core change. `Payment.Amount` becomes authoritative; allocations become optional for `Direction == Receipt` with `ContactType == "Client"`.

**Files:**
- Modify: `DTOs/PaymentDtos.cs:65-87`
- Modify: `Services/Implementations/PaymentService.cs:74-290`
- Test: `scripts/test_customer_receipts_ledger.py`

**Interfaces:**
- Consumes: Task 2's advance leg.
- Produces: `CreatePaymentDto.Amount` (`decimal`). `PaymentDto.UnallocatedAmount` (`decimal`) = `Amount − Σ allocations.(Amount + AdjustmentAmount)`.

- [ ] **Step 1: Write the failing test**

In `scripts/test_customer_receipts_ledger.py`:

```python
def test_receipt_without_invoice_creates_advance(api, company_id, client_id):
    """A receipt with no allocation lines saves, and becomes customer advance."""
    r = api.post(f"/api/receipts/company/{company_id}", json={
        "direction": "Receipt",
        "date": "2026-08-05",
        "contactType": "Client",
        "contactId": client_id,
        "method": "Cash",
        "amount": 100000,
        "allocations": [],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] == 100000
    assert body["unallocatedAmount"] == 100000
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `python scripts/test_customer_receipts_ledger.py -k receipt_without_invoice`
Expected: FAIL — 400 `"A payment needs at least one allocation line."`

- [ ] **Step 3: Add `Amount` to the DTO**

In `DTOs/PaymentDtos.cs`, in `CreatePaymentDto` before `Allocations`:

```csharp
        /// <summary>Cash total of the document. Authoritative — allocations may
        /// cover all, part, or none of it. The uncovered remainder is the
        /// customer's advance. Legacy callers that omit it fall back to
        /// Σ allocation amounts, preserving the old behaviour exactly.</summary>
        public decimal? Amount { get; set; }
```

Nullable is deliberate: every existing caller omits it and must keep working.

- [ ] **Step 4: Replace the blanket allocation requirement**

In `PaymentService.CreateAsync`, replace lines 78-79:

```csharp
            var isCustomerReceipt = direction == PaymentDirection.Receipt
                && string.Equals(dto.ContactType?.Trim(), "Client", StringComparison.OrdinalIgnoreCase)
                && dto.ContactId.HasValue;

            // An unapplied balance needs an account to live on. A customer
            // receipt has one; a money-out payment or a party-less "Other"
            // receipt does not, so those still require at least one line.
            if ((dto.Allocations == null || dto.Allocations.Count == 0) && !isCustomerReceipt)
                throw new InvalidOperationException("A payment needs at least one allocation line.");
            dto.Allocations ??= new List<CreatePaymentAllocationDto>();
```

- [ ] **Step 5: Make `Amount` authoritative**

Replace line 237 (`Amount = dto.Allocations.Sum(a => a.Amount),`):

```csharp
                Amount = ResolveAmount(dto),
```

And add the helper plus its invariant check, called before the entity is built:

```csharp
        /// <summary>Cash total of the document. Explicit when supplied; otherwise
        /// Σ allocation cash, which is what every pre-2026-08-29 caller meant.</summary>
        private static decimal ResolveAmount(CreatePaymentDto dto) =>
            dto.Amount ?? dto.Allocations.Sum(a => a.Amount);

        /// <summary>Allocations may spend part of the receipt's CASH, but never
        /// more than it — the difference is the advance, and it cannot be
        /// negative. AdjustmentAmount is deliberately absent: it is a non-cash
        /// write-off, so a 1000 receipt may legitimately clear an 1100 invoice
        /// as 1000 cash + 100 written off.</summary>
        private static void AssertAllocationsFitAmount(CreatePaymentDto dto)
        {
            var amount = ResolveAmount(dto);
            var appliedCash = dto.Allocations.Sum(a => a.Amount);
            if (appliedCash > amount)
                throw new InvalidOperationException(
                    $"Allocations apply {appliedCash:0.00} in cash, which is more than the receipt amount {amount:0.00}.");
            if (amount <= 0m)
                throw new InvalidOperationException("A receipt must be for a positive amount.");
        }
```

- [ ] **Step 6: Expose the derived remainder**

In the `ToDto` mapper in `PaymentService.cs`, add:

```csharp
                // CASH only — AdjustmentAmount is non-cash (see Global Constraints).
                UnallocatedAmount = p.Amount - p.Allocations.Sum(a => a.Amount),
```

and the matching `public decimal UnallocatedAmount { get; set; }` on `PaymentDto` in `DTOs/PaymentDtos.cs`.

- [ ] **Step 7: Mirror all of it in `UpdateAsync`**

`UpdateAsync` carries a duplicate of the same validation at `PaymentService.cs:303-304` and `:405`. Apply the identical four changes there — the blanket requirement, `ResolveAmount`, `AssertAllocationsFitAmount`, and the `Amount` assignment. Leaving `UpdateAsync` behind would let an edit destroy an advance.

- [ ] **Step 8: Run the test**

Run: `python scripts/test_customer_receipts_ledger.py -k receipt_without_invoice`
Expected: PASS

- [ ] **Step 9: Prove `AmountPaid` is untouched**

```python
def test_unallocated_receipt_does_not_touch_invoice_amountpaid(api, company_id, client_id, invoice_id):
    before = api.get(f"/api/invoices/{invoice_id}").json()["amountPaid"]
    api.post(f"/api/receipts/company/{company_id}", json={
        "direction": "Receipt", "date": "2026-08-06", "contactType": "Client",
        "contactId": client_id, "method": "Cash", "amount": 250000, "allocations": [],
    })
    after = api.get(f"/api/invoices/{invoice_id}").json()
    assert after["amountPaid"] == before
    assert after["paymentStatus"] != "Paid"
```

Run: `python scripts/test_customer_receipts_ledger.py`
Expected: all PASS

- [ ] **Step 10: Confirm nothing regressed**

Run: `python scripts/test_basic_flows.py`
Expected: all PASS

- [ ] **Step 11: Commit**

```bash
git add DTOs/PaymentDtos.cs Services/Implementations/PaymentService.cs scripts/test_customer_receipts_ledger.py
git commit -m "Allow customer receipts with no invoice allocation"
```

---

### Task 4: Allocate an advance to invoices later

**Files:**
- Modify: `Services/Implementations/PaymentService.cs`
- Modify: `Services/Interfaces/IPaymentService.cs`
- Modify: `Controllers/PaymentsController.cs`
- Test: `scripts/test_customer_receipts_ledger.py`

**Interfaces:**
- Consumes: `PaymentDto.UnallocatedAmount` (Task 3).
- Produces: `Task<PaymentDto?> AllocateAsync(int paymentId, List<CreatePaymentAllocationDto> lines)`; route `POST /api/receipts/{id}/allocate`.

- [ ] **Step 1: Write the failing test**

```python
def test_allocate_advance_to_later_invoice(api, company_id, client_id):
    rcp = api.post(f"/api/receipts/company/{company_id}", json={
        "direction": "Receipt", "date": "2026-08-20", "contactType": "Client",
        "contactId": client_id, "method": "Bank Transfer",
        "amount": 5000000, "allocations": [],
    }).json()
    assert rcp["unallocatedAmount"] == 5000000

    inv = create_invoice(api, company_id, client_id, total=300000)
    r = api.post(f"/api/receipts/{rcp['id']}/allocate",
                 json=[{"invoiceId": inv["id"], "amount": 300000}])
    assert r.status_code == 200, r.text
    assert r.json()["unallocatedAmount"] == 4700000
    assert api.get(f"/api/invoices/{inv['id']}").json()["amountPaid"] == 300000
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `python scripts/test_customer_receipts_ledger.py -k allocate_advance`
Expected: FAIL — 404, route does not exist

- [ ] **Step 3: Implement `AllocateAsync`**

```csharp
        /// <summary>Apply part of a receipt's unallocated balance to invoices.
        /// Reuses the create-path guards: each invoice must belong to the same
        /// company, must not be over-paid, and the new lines plus the existing
        /// ones may not exceed the receipt amount.</summary>
        public async Task<PaymentDto?> AllocateAsync(int paymentId, List<CreatePaymentAllocationDto> lines)
        {
            var payment = await _repo.GetByIdAsync(paymentId);
            if (payment == null) return null;
            if (payment.Direction != PaymentDirection.Receipt)
                throw new InvalidOperationException("Only a receipt can be allocated to invoices.");
            if (payment.IsCancelled)
                throw new InvalidOperationException("A cancelled receipt cannot be allocated.");
            if (lines == null || lines.Count == 0)
                throw new InvalidOperationException("Choose at least one invoice to allocate to.");
            if (lines.Any(l => !l.InvoiceId.HasValue))
                throw new InvalidOperationException("A receipt allocation must target a sales invoice.");

            // CASH only on both sides — see Global Constraints.
            var appliedCash = payment.Allocations.Sum(a => a.Amount);
            var addingCash = lines.Sum(l => l.Amount);
            if (appliedCash + addingCash > payment.Amount)
                throw new InvalidOperationException(
                    $"Only {payment.Amount - appliedCash:0.00} of this receipt is unallocated.");

            // Same company, and no invoice pushed past its balance.
            await AssertInvoicesBelongToCompanyAsync(payment.CompanyId, lines);
            await AssertNoInvoiceOverpayAsync(payment.CompanyId, lines);

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                foreach (var l in lines)
                    payment.Allocations.Add(new PaymentAllocation
                    {
                        PaymentId = payment.Id,
                        InvoiceId = l.InvoiceId,
                        Amount = l.Amount,
                        AdjustmentAmount = l.AdjustmentAmount,
                        AdjustmentAccountId = l.AdjustmentAmount > 0 ? l.AdjustmentAccountId : null,
                    });
                await _context.SaveChangesAsync();

                foreach (var id in lines.Select(l => l.InvoiceId!.Value).Distinct())
                    await RecomputeInvoiceAsync(id);
                await _context.SaveChangesAsync();

                // Re-post: the advance leg shrinks by exactly what A/R gains.
                await _posting.PostPaymentAsync(payment);
                await tx.CommitAsync();
            }
            catch { await tx.RollbackAsync(); throw; }

            return await GetByIdAsync(payment.Id);
        }
```

Extract `AssertInvoicesBelongToCompanyAsync` and `AssertNoInvoiceOverpayAsync` from the existing inline blocks at `PaymentService.cs:139` and `:182-194` so create, update and allocate share one implementation rather than three copies.

- [ ] **Step 4: Add the route**

In `Controllers/PaymentsController.cs`:

```csharp
        /// <summary>Apply a receipt's unallocated balance (the customer's advance)
        /// to one or more of that customer's invoices.</summary>
        [HttpPost("~/api/receipts/{id}/allocate")]
        [HasPermission("accounting.receipts.create")]
        public async Task<ActionResult<PaymentDto>> Allocate(int id, [FromBody] List<CreatePaymentAllocationDto> lines)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.AllocateAsync(id, lines);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Allocate receipt {Id} failed", id);
                return StatusCode(500, new { error = "Could not allocate the receipt. Please try again." });
            }
        }
```

Tenant guard reads `CompanyId` off the **stored** payment, never the body.

- [ ] **Step 5: Run the test**

Run: `python scripts/test_customer_receipts_ledger.py -k allocate_advance`
Expected: PASS

- [ ] **Step 6: Add the tenant-isolation case**

Add to `scripts/test_tenant_isolation.py`: a user with access to company A calling `POST /api/receipts/{id}/allocate` for a receipt in company B gets 403.

Run: `python scripts/test_tenant_isolation.py`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add Services/Implementations/PaymentService.cs Services/Interfaces/IPaymentService.cs Controllers/PaymentsController.cs scripts/
git commit -m "Allow allocating a customer advance to invoices"
```

---

### Task 5: `CustomerLedgerService` — the derived trail

Replaces `ClientService.GetStatementAsync` and fixes its four defects: credit/debit notes excluded, adjustments not credited, a hard 200-row cap, and no opening balance.

**Files:**
- Create: `Services/Implementations/CustomerLedgerService.cs`
- Create: `Services/Interfaces/ICustomerLedgerService.cs`
- Create: `DTOs/CustomerLedgerDtos.cs`
- Modify: `Services/Implementations/ClientService.cs:487-534`
- Modify: `Program.cs` — DI registration

**Interfaces:**
- Consumes: `Payment`, `PaymentAllocation`, `Invoice`, `Client`.
- Produces:
  - `Task<CustomerLedgerDto> GetForClientAsync(int companyId, int clientId, DateTime? from, DateTime? to, string? type, int page, int pageSize)`
  - `Task<List<CustomerLedgerRowDto>> GetAllCustomersAsync(int companyId, DateTime? from, DateTime? to)`
  - `CustomerLedgerRowDto { int ClientId; string ClientName; decimal Opening; decimal Invoiced; decimal Received; decimal Outstanding; decimal Advance; decimal Closing; }`
  - `CustomerLedgerEntryDto { DateTime Date; string Reference; string Type; decimal Debit; decimal Credit; decimal Balance; string? Method; string? Description; int? DocId; }`
  - `CustomerLedgerDto { int ClientId; string ClientName; decimal OpeningBalance; decimal ClosingBalance; decimal Outstanding; decimal Advance; int Total; List<CustomerLedgerEntryDto> Entries; }`

- [ ] **Step 1: Write the failing test — the requirement's own table**

```python
def test_ledger_matches_client_scenario(api, company_id, client_id):
    """01 Aug INV 300k, 05 Aug REC 100k, 10 Aug INV 500k,
       15 Aug REC 200k, 20 Aug REC 5,000k -> closing -4,500,000."""
    create_invoice(api, company_id, client_id, total=300000, date="2026-08-01")
    create_receipt(api, company_id, client_id, amount=100000, date="2026-08-05")
    create_invoice(api, company_id, client_id, total=500000, date="2026-08-10")
    create_receipt(api, company_id, client_id, amount=200000, date="2026-08-15")
    create_receipt(api, company_id, client_id, amount=5000000, date="2026-08-20")

    led = api.get(f"/api/customer-ledger/company/{company_id}/client/{client_id}").json()
    balances = [e["balance"] for e in sorted(led["entries"], key=lambda e: e["date"])]
    assert balances == [300000, 200000, 700000, 500000, -4500000]
    assert led["closingBalance"] == -4500000
    assert led["advance"] == 4500000
    assert led["outstanding"] == 0
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `python scripts/test_customer_receipts_ledger.py -k ledger_matches_client_scenario`
Expected: FAIL — 404, route does not exist

- [ ] **Step 3: Implement the entry composition**

Debits: sales invoices, **including** debit notes. Credits: receipts at their **full `Amount`** (not per-allocation, so unallocated cash appears), plus credit notes. Every branch filters on `CompanyId` **and** `ClientId`.

```csharp
        /// <summary>Chronological money-in/money-out trail for one customer.
        /// Credits use the receipt's full Amount — the unallocated part is real
        /// money received and must show, which is exactly what the old
        /// per-allocation statement missed.</summary>
        public async Task<CustomerLedgerDto> GetForClientAsync(
            int companyId, int clientId, DateTime? from, DateTime? to,
            string? type, int page, int pageSize)
        {
            var client = await _context.Clients.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == clientId && c.CompanyId == companyId)
                ?? throw new InvalidOperationException("Client not found.");

            var entries = new List<CustomerLedgerEntryDto>();

            // Debits — invoices and debit notes. Demo and cancelled excluded;
            // credit notes (DocumentType 9) are credits and handled below.
            var invoices = await _context.Invoices.AsNoTracking()
                .Where(i => i.ClientId == clientId && i.CompanyId == companyId
                            && !i.IsDemo && !i.IsCancelled && i.DocumentType != 10)
                .Select(i => new { i.Id, i.InvoiceNumber, i.Date, i.GrandTotal, i.DocumentType })
                .ToListAsync();
            foreach (var i in invoices)
                entries.Add(new CustomerLedgerEntryDto
                {
                    Date = i.Date,
                    // 9 = Debit Note, 10 = Credit Note (Invoice.cs:102,151). NOT the
                    // other way round — an earlier draft of this plan had them inverted.
                    Type = i.DocumentType == 9 ? "Debit Note" : "Invoice",
                    Reference = (i.DocumentType == 9 ? "DN-" : "INV-") + i.InvoiceNumber,
                    DocId = i.Id,
                    Debit = i.GrandTotal,
                });

            // Credits — credit notes.
            var creditNotes = await _context.Invoices.AsNoTracking()
                .Where(i => i.ClientId == clientId && i.CompanyId == companyId
                            && !i.IsDemo && !i.IsCancelled && i.DocumentType == 10)
                .Select(i => new { i.Id, i.InvoiceNumber, i.Date, i.GrandTotal })
                .ToListAsync();
            foreach (var n in creditNotes)
                entries.Add(new CustomerLedgerEntryDto
                {
                    Date = n.Date, Type = "Credit Note", Reference = "CN-" + n.InvoiceNumber,
                    DocId = n.Id, Credit = n.GrandTotal,
                });

            // Credits — receipts, at full amount.
            var receipts = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId
                            && p.Direction == PaymentDirection.Receipt
                            && !p.IsCancelled
                            && p.ContactType == "Client" && p.ContactId == clientId)
                .Select(p => new { p.Id, p.Number, p.Date, p.Amount, p.Method, p.Description })
                .ToListAsync();
            foreach (var r in receipts)
                entries.Add(new CustomerLedgerEntryDto
                {
                    Date = r.Date, Type = "Receipt", Reference = $"RCP-{r.Number:D4}",
                    DocId = r.Id, Credit = r.Amount, Method = r.Method, Description = r.Description,
                });

            // Credits — settle-remainder adjustments. The old statement omitted
            // these while AmountPaid counted them, so its closing balance
            // disagreed with A/R whenever a discount was given.
            var adjustments = await (
                from a in _context.PaymentAllocations.AsNoTracking()
                join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                join inv in _context.Invoices.AsNoTracking() on a.InvoiceId equals inv.Id
                where a.AdjustmentAmount > 0m && inv.ClientId == clientId
                      && inv.CompanyId == companyId && !p.IsCancelled
                      && p.Direction == PaymentDirection.Receipt
                select new { p.Number, p.Date, a.AdjustmentAmount, a.Id }
            ).ToListAsync();
            foreach (var a in adjustments)
                entries.Add(new CustomerLedgerEntryDto
                {
                    Date = a.Date, Type = "Adjustment", Reference = $"RCP-{a.Number:D4}",
                    DocId = a.Id, Credit = a.AdjustmentAmount,
                });

            // Opening balance = everything strictly before `from`; the window
            // then carries a running balance that starts from it.
            var ordered = entries.OrderBy(e => e.Date).ThenByDescending(e => e.Debit).ToList();
            decimal opening = 0m;
            if (from.HasValue)
            {
                opening = ordered.Where(e => e.Date < from.Value).Sum(e => e.Debit - e.Credit);
                ordered = ordered.Where(e => e.Date >= from.Value).ToList();
            }
            if (to.HasValue) ordered = ordered.Where(e => e.Date <= to.Value).ToList();
            if (!string.IsNullOrWhiteSpace(type))
                ordered = ordered.Where(e => e.Type == type).ToList();

            var running = opening;
            foreach (var e in ordered) { running += e.Debit - e.Credit; e.Balance = running; }

            var closing = running;
            var advance = closing < 0 ? -closing : 0m;
            var outstanding = closing > 0 ? closing : 0m;

            var size = PaginationHelper.Clamp(pageSize, 50);
            var pageNo = PaginationHelper.ClampPage(page);
            var total = ordered.Count;
            ordered.Reverse();                       // newest-first for display

            return new CustomerLedgerDto
            {
                ClientId = clientId, ClientName = client.Name,
                OpeningBalance = opening, ClosingBalance = closing,
                Outstanding = outstanding, Advance = advance,
                Total = total,
                Entries = ordered.Skip((pageNo - 1) * size).Take(size).ToList(),
            };
        }
```

- [ ] **Step 4: Register in DI**

In `Program.cs`, beside the other accounting services:

```csharp
builder.Services.AddScoped<ICustomerLedgerService, CustomerLedgerService>();
```

- [ ] **Step 5: Point the old statement at the new service**

`ClientService.GetStatementAsync` keeps its signature and callers, but delegates so there is exactly one implementation of the trail. Delete the body at `ClientService.cs:487-534` and map the ledger result onto `ClientStatementDto`.

- [ ] **Step 6: Run the tests**

Run: `python scripts/test_customer_receipts_ledger.py`
Expected: all PASS

- [ ] **Step 7: Prove the discount bug is fixed**

```python
def test_settle_remainder_keeps_ledger_equal_to_ar(api, company_id, client_id):
    inv = create_invoice(api, company_id, client_id, total=100000)
    api.post(f"/api/receipts/company/{company_id}", json={
        "direction": "Receipt", "date": "2026-08-11", "contactType": "Client",
        "contactId": client_id, "method": "Cash", "amount": 90000,
        "allocations": [{"invoiceId": inv["id"], "amount": 90000,
                         "adjustmentAmount": 10000,
                         "adjustmentAccountId": discount_account_id(api, company_id)}],
    })
    led = api.get(f"/api/customer-ledger/company/{company_id}/client/{client_id}").json()
    assert api.get(f"/api/invoices/{inv['id']}").json()["balanceDue"] == 0
    assert led["closingBalance"] == 0      # was 10,000 before this fix
```

Run: `python scripts/test_customer_receipts_ledger.py -k settle_remainder`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add Services/ DTOs/CustomerLedgerDtos.cs Program.cs scripts/
git commit -m "Add customer ledger and fix statement balance defects"
```

---

### Task 6: Ledger API, permissions and section mapping

**Files:**
- Create: `Controllers/CustomerLedgerController.cs`
- Modify: `Helpers/PermissionCatalog.cs:136`
- Modify: `myapp-frontend/src/config/permissionSections.js`

**Interfaces:**
- Consumes: `ICustomerLedgerService` (Task 5).
- Produces: `GET /api/customer-ledger/company/{companyId}`, `GET /api/customer-ledger/company/{companyId}/client/{clientId}`; permission key `customerledger.list.view`.

- [ ] **Step 1: Add the permission**

In `Helpers/PermissionCatalog.cs`, after the receipts block:

```csharp
            new("customerledger.list.view",  "CustomerLedger", "Customer Ledger", "View",  "View every customer's balance and their full money in/out ledger"),
            new("customerledger.list.print", "CustomerLedger", "Customer Ledger", "Print", "Print or download a customer statement"),
```

- [ ] **Step 2: Map the module to a navbar section**

In `myapp-frontend/src/config/permissionSections.js`, inside the Accounting section's `modules` array:

```javascript
      { key: "CustomerLedger", label: "Customer Ledger" },
```

- [ ] **Step 3: Verify the mapping**

Run: `python scripts/verify_permission_sections.py`
Expected: `All permission modules are mapped to navbar sections.`

This must pass **before** the controller lands — an unmapped module falls into the role editor's "Other" bucket.

- [ ] **Step 4: Write the controller**

```csharp
        [HttpGet("company/{companyId}")]
        [HasPermission("customerledger.list.view")]
        public async Task<ActionResult<List<CustomerLedgerRowDto>>> GetAll(
            int companyId, [FromQuery] DateTime? from, [FromQuery] DateTime? to)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            try { return Ok(await _service.GetAllCustomersAsync(companyId, from, to)); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Customer ledger list failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not load the customer ledger." });
            }
        }
```

The per-client route mirrors it, resolving `clientId` **inside** the company scope so a foreign id 404s rather than leaking.

- [ ] **Step 5: Add tenant-isolation cases**

Both routes, in `scripts/test_tenant_isolation.py`: cross-company `companyId` → 403; foreign `clientId` within an accessible company → 404.

Run: `python scripts/test_tenant_isolation.py`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add Controllers/CustomerLedgerController.cs Helpers/PermissionCatalog.cs myapp-frontend/src/config/permissionSections.js scripts/test_tenant_isolation.py
git commit -m "Expose customer ledger endpoints behind a new permission"
```

---

### Task 7: Receipts screen — make the invoice optional

**Files:**
- Modify: `myapp-frontend/src/Components/PaymentForm.jsx`
- Modify: `myapp-frontend/src/api/paymentApi.js`

**Interfaces:**
- Consumes: `POST /api/receipts/company/{companyId}` with `amount` and optional `allocations` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Add an explicit Amount field**

In receipt mode the amount is typed, not summed. Bind it to `amount` in the request body. In payment (money-out) mode the field stays derived — that path is unchanged.

- [ ] **Step 2: Make invoice selection optional**

Drop the "select at least one invoice" client-side guard for receipts. Saving with zero invoices selected is now valid.

- [ ] **Step 3: Show the split live**

Under the invoice list, as the operator ticks invoices:

```jsx
<div style={st.splitRow}>
  <span>Allocated</span><strong>{fmt(allocated)}</strong>
  <span>Advance</span><strong>{fmt(Math.max(0, amount - allocated))}</strong>
</div>
```

Warn inline when `allocated > amount` — the server rejects it, so the button must not 400 on click.

- [ ] **Step 4: Verify it renders**

Screenshots are broken on this machine — DOM-measure instead. In the browser console with the receipt form open:

```javascript
document.querySelectorAll('[data-testid="receipt-amount"]').length
```
Expected: `1`, and the split row updates as invoices are ticked.

- [ ] **Step 5: Rebuild the bundle**

```bash
cd myapp-frontend && npm run build
```

Copy `dist/*` into `wwwroot/` and include it in the same commit as the source change.

- [ ] **Step 6: Commit**

```bash
git add myapp-frontend/src wwwroot
git commit -m "Let a receipt save without picking an invoice"
```

---

### Task 8: Customer Ledger page — the new tab

**Files:**
- Create: `myapp-frontend/src/pages/CustomerLedgerPage.jsx`
- Create: `myapp-frontend/src/api/customerLedgerApi.js`
- Modify: `myapp-frontend/src/App.jsx`
- Modify: `myapp-frontend/src/layouts/DashboardLayout.jsx:511`

**Interfaces:**
- Consumes: both routes from Task 6.
- Produces: route `/customer-ledger`.

- [ ] **Step 1: Add the nav entry**

Beside the existing Receipts/Payments entries, gated so it does not render without permission:

```jsx
<Can permission="customerledger.list.view">
  <NavLink to="/customer-ledger" className={({ isActive }) => "dl-subitem" + (isActive ? " dl-subitem--active" : "")}>
    <MdAccountBalance className="dl-subitem__icon" aria-hidden="true" />
    <span>Customer Ledger</span>
  </NavLink>
</Can>
```

Add `/customer-ledger` to the section-matcher at `DashboardLayout.jsx:262` so the Accounting group highlights.

- [ ] **Step 2: Aggregate row list**

One row per customer: name, Opening, Invoiced, Received, Outstanding, Advance, Closing. Right-align figures with tabular numerals so columns read like a statement. Customer names use `WebkitLineClamp: 2` — **not** `whiteSpace: "nowrap"`, which collapsed similar-prefix names in the 2026-05-13 dashboard incident.

- [ ] **Step 3: Expand in place**

Clicking a row expands it beneath itself and fetches that client's entries; collapsing returns to the list with no navigation. Track by `clientId` in a `Set` so several rows can be open at once.

- [ ] **Step 4: Filters**

Date range, transaction type, method, and "has outstanding" / "has advance". Pass `style={dropdownStyles.base}` to shared select components — a bare `<DivisionSelect>` renders an unstyled native `<select>`.

- [ ] **Step 5: Verify at three widths**

375 / 768 / 1280. Grid collapses to one column on the phone; the expanded table scrolls inside its own `overflow-x: auto` container so the page body never scrolls sideways.

- [ ] **Step 6: Rebuild and commit**

```bash
cd myapp-frontend && npm run build
```

```bash
git add myapp-frontend/src wwwroot
git commit -m "Add Customer Ledger screen with per-customer drill-down"
```

---

### Task 9: Make the customer portal advance-aware

`PublicCustomerPortalController` is one of two `[AllowAnonymous]` controllers in the repo. Read its header comment before touching it.

**Files:**
- Modify: `Services/Implementations/CustomerPortalService.cs`
- Modify: `scripts/test_customer_portal.py`

- [ ] **Step 1: Net advances into the portal's outstanding figure**

A customer with credit must not be shown a balance that ignores it. Reuse `ICustomerLedgerService` scoped to the portal's resolved `CompanyId` **and** `ClientId` — never synthesise a user id to reuse the tenant guards.

- [ ] **Step 2: Add the IDOR case**

Suite 4 of `scripts/test_customer_portal.py` is the only automated proof the hand-rolled scope holds. Add: a portal token for client A must never surface client B's ledger or advance.

- [ ] **Step 3: Run the suite**

Run: `python scripts/test_customer_portal.py`
Expected: 94/94 plus the new cases

- [ ] **Step 4: Commit**

```bash
git add Services/Implementations/CustomerPortalService.cs scripts/test_customer_portal.py
git commit -m "Net customer advances into the portal balance"
```

---

### Task 10: Company-creation defaults

Two of the four are already done: `CreateCompanyDto.cs:26` has `FbrEnabled = false`, `:51` has `InventoryFlowVersion = 2`. Remaining: `IsTenantIsolated` and GL-on.

**Files:**
- Modify: `DTOs/CreateCompanyDto.cs:72`
- Modify: `Services/Implementations/CompanyService.cs`
- Modify: `myapp-frontend/src/pages/CompanyPage.jsx`

- [ ] **Step 1: Default the isolation flag**

```csharp
        /// <summary>"Restrict to assigned users only". Informational metadata —
        /// access is already fail-closed for every non-seed-admin via UserCompany
        /// (see CompanyAccessGuard). Defaulted true so the UI reflects reality.</summary>
        public bool IsTenantIsolated { get; set; } = true;
```

- [ ] **Step 2: Enable the GL on create**

In `CompanyService.CreateAsync`, after the company is saved and its chart seeded:

```csharp
            // New companies run on the ledger from day one. Existing tenants are
            // untouched — this fires only on the create path.
            await _generalLedger.EnableAsync(company.Id);
```

Inject `IGeneralLedgerService`. If enabling throws, the company must still be created — log and continue rather than failing the whole operation.

- [ ] **Step 3: Match the frontend form defaults**

DTO defaults only apply when the client **omits** a field. Confirm the create form does not post explicit `false`/`1` values that override them; if it does, change the form's initial state to match.

- [ ] **Step 4: Verify with a throwaway company**

Create one through the UI, then check: `fbrEnabled` false, `inventoryFlowVersion` 2, `isTenantIsolated` true, and `GET /api/accounting/company/{id}/status` reports the GL enabled.

- [ ] **Step 5: Confirm existing tenants did not move**

Companies 1 and 2 must be unchanged.

Run: `python scripts/test_tenant_isolation.py`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add DTOs/CreateCompanyDto.cs Services/Implementations/CompanyService.cs myapp-frontend/src wwwroot
git commit -m "Default new companies to GL on and restricted access"
```

---

### Task 11: Full verification and changelog

- [ ] **Step 1: Run every check**

```bash
dotnet build MyApp.Api.csproj
```

| Check | Must show |
|---|---|
| `python scripts/verify_audit_2026_05_13_security.py` | `67/67 checks passed` |
| `python scripts/verify_permission_sections.py` | all mapped |
| `python scripts/verify_public_file_allowlist.py` | `10/10` |
| `python scripts/test_basic_flows.py` | all PASS |
| `python scripts/test_tenant_isolation.py` | all PASS |
| `python scripts/test_document_copy.py` | `184/184` |
| `python scripts/test_customer_portal.py` | 94/94 + new |
| `python scripts/test_customer_receipts_ledger.py` | all PASS |

- [ ] **Step 2: Append the README changelog**

`README.md` `## Changelog`, newest first, under `### 2026-08-29`. User-facing wording — what the operator can now do, not which classes changed. This is a hard rule in `CLAUDE.md`, on par with the tests.

- [ ] **Step 3: Delete the spec**

`FEATURE_CUSTOMER_RECEIPTS_LEDGER.md` and this plan are transient. Once the feature is implemented **and verified**, delete both in the same session — the durable record is the README changelog plus git history. Confirm nothing in source, scripts or `CLAUDE.md` cites either file first.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document customer receipts and ledger in the changelog"
```

---

## Self-Review

**Spec coverage.** §1 problem → Task 3. §4.1 model → Task 3. §4.2 derived ledger → Task 5. §4.3 grouping → Task 5 aggregates. §5 invariants → Task 3 step 9, Task 4 guards, Task 9. §6 statement defects → Task 5 steps 5 and 7. §7 data model → Task 3 (no migration). §8 API → Tasks 4 and 6. §9 UI → Tasks 7 and 8. §10 permissions → Task 6. §11 GL → Tasks 1 and 2. §12 company defaults → Task 10. §13 tests → every task plus Task 11.

**Known gap, deliberate.** §7 calls for a pre-flight data check that every existing receipt satisfies `Amount == Σ allocations` before the invariant loosens. Not yet a task — it needs a read-only query against production data, and the result decides whether a repair step is required at all. Run it before Task 3 ships:

```sql
SELECT p.Id, p.Number, p.Amount, SUM(a.Amount) AS AllocatedCash
FROM Payments p JOIN PaymentAllocations a ON a.PaymentId = p.Id
WHERE p.Direction = 0
GROUP BY p.Id, p.Number, p.Amount
HAVING p.Amount <> SUM(a.Amount);
```

Any row returned is a pre-existing inconsistency: report it, never silently coerce.

**Type consistency.** `UnallocatedAmount` is defined in Task 3 and consumed in Task 4. `ControlType.CustomerAdvances` is defined in Task 1 and consumed in Task 2. `ICustomerLedgerService` is defined in Task 5 and consumed in Tasks 6 and 9. `customerledger.list.view` is defined in Task 6 and consumed in Task 8.

---

### Task 12: Client Ledger report (Reports module)

Queued by the user on 2026-08-30 with a reference workbook:
`Alpha Trader Ledger Jul 2025 to Jun 2026.xlsx` (65 per-client sheets + a
Chart of Account sheet). Build AFTER tasks 1-11. This is the Reports-module
equivalent of the Customer Ledger screen: company-wide, every client, with a
period filter and a client filter.

**Reference format, read from the workbook (exact):**

```
A1  ALPHA TRADERS                     <- company name
A2  Ledger
A3  Ad Communication                  <- client name
row 4   E=Opening   F=Σ Debit   G=Σ Credit      <- totals band
row 5   S.No | Date | Month/Inv | Particulars | Opening | Debit | Credit | Balance
row 6   opening row: E=opening, H=opening (running balance seed)
row 7+  transactions, H = running balance
```

Column C is `Inv` on some sheets and `Month` on others — normalise to one
labelled column. Sheets carry 8 or 10 columns inconsistently; the report emits
one consistent shape.

**⚠️ NOTE TYPE CODES — an earlier draft of this plan had these INVERTED.**
Authoritative, per `Invoice.cs:102,151`, `InvoiceService.cs:2414`,
`PostingService.cs:228`, `CompanyService.cs:319/325`:
**`DocumentType 9 = Debit Note`, `DocumentType 10 = Credit Note`.**
Getting this backwards under the workbook convention is a doubled error: a credit
note would be labelled a debit note AND placed in the Credit column, so the
statement would overstate what the customer owes by twice each credit note.

**⚠️ SIGN CONVENTION CONFLICT — must be settled before implementing.**
The workbook and the user's written requirement disagree:

| | invoice | receipt/payment | worked example |
|---|---|---|---|
| **Workbook** (this file) | **Credit** | **Debit** | Brothers & Co: opening 355,525 → invoice AA-21 Credit 862,261 → balance 1,217,786 → Transfer Debit 343,536 → 874,250 |
| **Written requirement** (2026-08-29 message) and `CustomerLedgerService` (Task 5) | **Debit** | **Credit** | INV-001 Debit 300,000 → balance 300,000; REC-001 Credit 100,000 → balance 200,000 |

Both compute the same balance; only the column each amount lands in differs.
The written form is the standard A/R convention and is what Task 5 builds. Do
NOT silently pick one — ask the user which the report must match. If they want
the workbook's layout, the report is a presentation-level column swap over the
same `CustomerLedgerService` data, NOT a second ledger implementation.

**Files:**
- Modify: `Controllers/ReportsController.cs` — add the endpoint beside the existing report actions
- Modify: `Services/Implementations/ReportService.cs` — compose from `ICustomerLedgerService` (Task 5); do not re-derive ledger logic
- Modify: `DTOs/` — report DTO
- Create: `myapp-frontend/src/pages/ClientLedgerReportPage.jsx`
- Modify: `Helpers/PermissionCatalog.cs` + `myapp-frontend/src/config/permissionSections.js`

**Requirements:**
- **Period:** reuse the existing contract exactly — `year`/`month` OR `dateFrom`/`dateTo`, validated by `ReportsController.ValidatePeriod` (`ReportsController.cs:56`). Do not invent a new period shape.
- **Client filter:** optional `clientId`; omitted = every client in the company.
- **Opening balance** = everything strictly before the period start, per client.
- Excel export routes every operator string through `CsvSafe` so `=WEBSERVICE`/`=HYPERLINK` injections are neutralised.
- Tenant guard + `[HasPermission(...)]` on the endpoint; `PaginationHelper` on any paged view.
- Group by `Client.ClientGroupId ?? -ClientId`, matching Task 5 and `DashboardService`.

**Depends on:** Task 5 (`ICustomerLedgerService`). Cannot start before it.
