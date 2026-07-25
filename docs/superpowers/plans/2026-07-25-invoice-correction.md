# Post-Submission Invoice Correction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a guided "Correct" action on any FBR-submitted invoice that issues the correct instrument — Credit Note, Debit Note, or an unclassified delta bill (+ cloned challan) — instead of hand-editing production data.

**Architecture:** Phase 1 adds the missing primitive: `CreateSupplementaryInvoiceAsync` creates a plain unclassified bill for the quantity delta and clones the original's delivery challan (reusing `DeliveryChallanRepository.DuplicateAsync` semantics), then hands it to the existing bill→tax-consultant→FBR pipeline. Phase 2 wraps Phase 1 + the existing `CreateNoteAsync` (Credit/Debit notes) in one auto-routing wizard that derives the instrument from the entered delta. Credit/Debit branches already exist and go straight to FBR; only the delta-bill branch is new.

**Tech Stack:** .NET 9 / EF Core 9 / SQL Server; React 19 + Vite; existing `ICompanyAccessGuard`, `NumberAllocationRetry`, `PermissionCatalog`, dual-book `InvoiceItemAdjustment`.

## Global Constraints
- Tenant guard every endpoint taking a companyId/invoiceId: `await _access.AssertAccessAsync(CurrentUserId, companyId)`. Never trust `dto.CompanyId`; assert against the loaded original's `CompanyId`.
- Permission on every action: reuse `invoices.note.create` (no new key).
- Persist invoice + cloned challan in **one `SaveChanges`** (SQL Server 2025 read-back constraint — see `InvoiceService.cs:783`).
- Cloned challan: reuse `ChallanNumber` (non-unique index), `DuplicatedFromId = root`, `SalesOrderId = null`, `Status = "Invoiced"`, no `CurrentChallanNumber` bump.
- Delta bill is **unclassified**: base non-HS `ItemTypeId`, no HSCode/SaleType/RateId, **no** `InvoiceItemAdjustment` overlay.
- Never return `ex.Message`; log + generic message. Reads `.AsNoTracking()`. No two concurrent `AppDbContext` ops.
- Never auto-start/restart backend; never auto-commit/push (ask). Frontend rebuild (`npm run build` + copy dist→wwwroot) is fine automatically.
- Branch DB only (`feat/*` → DeliveryChallanDb on `\MSSQLSERVER2`); never the prod replica.
- Mobile-first: test 375/768/1280; action buttons render only with permission.
- README `## Changelog` dated entry when the feature lands.

---

## PHASE 1 — Delta bill + challan carry-over

### Task 1: `SupplementsInvoiceId` model + migration

**Files:**
- Modify: `Models/Invoice.cs` (add FK field + nav)
- Modify: `Data/AppDbContext.cs` (relationship config, near the other Invoice self-FK `OriginalInvoice` config)
- Create: `Migrations/<stamp>_AddSupplementsInvoiceId.cs` (via `dotnet ef`)

**Interfaces:**
- Produces: `Invoice.SupplementsInvoiceId` (`int?`), `Invoice.SupplementsInvoice` (`Invoice?`)

- [ ] **Step 1:** In `Models/Invoice.cs`, after `OriginalInvoiceId`/`OriginalInvoice`, add:
```csharp
/// <summary>Local FK to the invoice this bill supplements (a delta bill billing goods under-reported on the original). Null for ordinary bills.</summary>
public int? SupplementsInvoiceId { get; set; }
public Invoice? SupplementsInvoice { get; set; }
```
- [ ] **Step 2:** In `AppDbContext.cs`, next to the existing `OriginalInvoice` self-reference config, add:
```csharp
modelBuilder.Entity<Invoice>()
    .HasOne(i => i.SupplementsInvoice).WithMany()
    .HasForeignKey(i => i.SupplementsInvoiceId)
    .OnDelete(DeleteBehavior.Restrict);
modelBuilder.Entity<Invoice>().HasIndex(i => i.SupplementsInvoiceId);
```
- [ ] **Step 3:** Generate the migration:
```bash
dotnet ef migrations add AddSupplementsInvoiceId --project MyApp.Api.csproj
```
- [ ] **Step 4:** Inspect the generated migration — it must ONLY add the nullable column + FK + index (no unrelated model drift). If drift appears, stop and reconcile.
- [ ] **Step 5:** `dotnet build MyApp.Api.csproj` → `0 Error(s)`.
- [ ] **Step 6:** Commit (ask first): `Add SupplementsInvoiceId FK for delta-bill audit link`.

### Task 2: Request DTO

**Files:**
- Modify: `DTOs/InvoiceDto.cs` (add DTO near `CreateNoteDto`/`NoteLineDto`)

**Interfaces:**
- Consumes: existing `NoteLineDto { int InvoiceItemId; decimal Quantity; decimal? UnitPrice; }`
- Produces: `CreateSupplementaryInvoiceDto`

- [ ] **Step 1:** Add:
```csharp
/// <summary>
/// Request to bill the quantity under-reported on an FBR-submitted invoice.
/// Creates a plain UNCLASSIFIED delta bill (bill-mode item type, no HS/overlay)
/// that re-enters the normal bill→tax-consultant→FBR pipeline, and clones the
/// original's delivery challan(s) at the delta quantity.
/// </summary>
public class CreateSupplementaryInvoiceDto
{
    /// <summary>Lines to bill. InvoiceItemId = the ORIGINAL line; Quantity = the DELTA quantity to add (must be > 0). UnitPrice optional (defaults to the original line's price).</summary>
    public List<NoteLineDto> Lines { get; set; } = new();
    /// <summary>Clone + link the original's delivery challan(s) at the delta qty so the delta bill prints the same DC#/PO. Default true.</summary>
    public bool CarryChallan { get; set; } = true;
    /// <summary>Optional note for the audit trail (e.g. "Balance quantity delivered").</summary>
    public string? Reason { get; set; }
    /// <summary>Delta bill date; defaults to today, never before the original.</summary>
    public DateTime? Date { get; set; }
}
```
- [ ] **Step 2:** `dotnet build` → 0 errors. (Committed with Task 3.)

### Task 3: `CreateSupplementaryInvoiceAsync` service method

**Files:**
- Modify: `Services/Interfaces/IInvoiceService.cs`
- Modify: `Services/Implementations/InvoiceService.cs` (new method; mirror the numbering/one-save pattern from `CreateAsync` ~L760-810 and `CreateNoteAsync` ~L2268)
- Modify: `scripts/test_basic_flows.py` (integration case — see Task 5)

**Interfaces:**
- Consumes: `CreateSupplementaryInvoiceDto`, `NoteLineDto`, `_context`, `_access`, `AcquireInvoiceNumberLockAsync`, `NumberAllocationRetry`, `DeliveryChallanRepository.DuplicateAsync` pattern.
- Produces: `Task<InvoiceDto?> CreateSupplementaryInvoiceAsync(int originalInvoiceId, CreateSupplementaryInvoiceDto dto, string? actorUserName = null)`

- [ ] **Step 1:** Add to `IInvoiceService`:
```csharp
/// <summary>
/// Bill the quantity under-reported on an FBR-submitted invoice as a NEW
/// unclassified sale bill (bill-mode item type, no HS/overlay) for the delta,
/// cloning + linking the original's delivery challan(s) at the delta qty. The
/// delta bill flows through the normal bill→tax-consultant→FBR pipeline. Throws
/// if the original isn't FBR-submitted. Returns null if not found.
/// </summary>
Task<InvoiceDto?> CreateSupplementaryInvoiceAsync(int originalInvoiceId, CreateSupplementaryInvoiceDto dto, string? actorUserName = null);
```
- [ ] **Step 2:** Implement in `InvoiceService`. Full logic:
```csharp
public async Task<InvoiceDto?> CreateSupplementaryInvoiceAsync(
    int originalInvoiceId, CreateSupplementaryInvoiceDto dto, string? actorUserName = null)
{
    var original = await _context.Invoices
        .AsNoTracking()
        .Include(i => i.Items)
        .Include(i => i.DeliveryChallans).ThenInclude(dc => dc.Items)
        .FirstOrDefaultAsync(i => i.Id == originalInvoiceId);
    if (original == null) return null;

    if (original.DocumentType == 9 || original.DocumentType == 10)
        throw new InvalidOperationException("A note cannot be supplemented. Reference the original sale invoice.");
    if (original.IsCancelled) throw new InvalidOperationException("This bill is cancelled.");
    if (original.IsDemo) throw new InvalidOperationException("Sandbox bills cannot be supplemented.");
    if (original.FbrStatus != "Submitted" || string.IsNullOrWhiteSpace(original.FbrIRN))
        throw new InvalidOperationException("Only an FBR-submitted invoice can be supplemented. Edit a non-submitted bill directly.");

    if (dto.Lines == null || dto.Lines.Count == 0)
        throw new InvalidOperationException("Select at least one line with a delta quantity greater than zero.");

    var byId = original.Items.ToDictionary(i => i.Id);
    // Build UNCLASSIFIED delta lines from the base invoice lines.
    var deltaItems = new List<InvoiceItem>();
    foreach (var sel in dto.Lines)
    {
        if (!byId.TryGetValue(sel.InvoiceItemId, out var src)) continue;
        var qty = sel.Quantity;
        if (qty <= 0) continue;
        var unitPrice = sel.UnitPrice.HasValue && sel.UnitPrice.Value > 0 ? sel.UnitPrice.Value : src.UnitPrice;
        deltaItems.Add(new InvoiceItem
        {
            ItemTypeId   = src.ItemTypeId,      // base non-HS ("Rubber")
            ItemTypeName = src.ItemTypeName,
            Description  = src.Description,
            Quantity     = qty,
            UOM          = src.UOM,
            UnitPrice    = unitPrice,
            LineTotal    = Math.Round(qty * unitPrice, 2),
            // NO HSCode / SaleType / RateId — unclassified; consultant classifies later.
            DeliveryItemId = null,
        });
    }
    if (deltaItems.Count == 0)
        throw new InvalidOperationException("No positive delta quantity to bill.");

    var subtotal   = deltaItems.Sum(i => i.LineTotal);
    var gstRate    = original.GSTRate;
    var gstAmount  = Math.Round(subtotal * gstRate / 100m, 2);
    var grandTotal = subtotal + gstAmount;

    var company = await _context.Companies.FirstOrDefaultAsync(c => c.Id == original.CompanyId)
        ?? throw new InvalidOperationException("Company not found.");

    var baseDate = (dto.Date ?? DateTime.UtcNow).Date;
    var billDate = baseDate < original.Date.Date ? original.Date.Date : baseDate;

    const int maxAttempts = NumberAllocationRetry.DefaultMaxAttempts;
    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        await using var tx = await _context.Database.BeginTransactionAsync();
        try
        {
            await AcquireInvoiceNumberLockAsync(original.CompanyId);
            var nextNumber = await _context.Invoices
                .Where(i => i.CompanyId == original.CompanyId && i.NoteKind == 0 && !i.IsDemo)
                .Select(i => (int?)i.InvoiceNumber).MaxAsync() ?? (company.StartingInvoiceNumber - 1);
            nextNumber += 1;

            var invoice = new Invoice
            {
                InvoiceNumber = nextNumber,
                Date = billDate,
                CompanyId = original.CompanyId,
                ClientId = original.ClientId,
                Subtotal = subtotal, GSTRate = gstRate, GSTAmount = gstAmount, GrandTotal = grandTotal,
                AmountInWords = AmountToWords(grandTotal),   // reuse existing helper used by CreateAsync
                SupplementsInvoiceId = original.Id,
                FbrInvoiceNumber = string.IsNullOrEmpty(company.InvoiceNumberPrefix) ? nextNumber.ToString() : $"{company.InvoiceNumberPrefix}{nextNumber}",
                Items = deltaItems,
            };
            _context.Invoices.Add(invoice);

            if (dto.CarryChallan)
            {
                foreach (var srcChallan in original.DeliveryChallans)
                {
                    // Only clone lines that match a delta line (by description, case-insensitive).
                    var descs = deltaItems.Select(d => d.Description.Trim().ToLowerInvariant()).ToHashSet();
                    var clonedItems = srcChallan.Items
                        .Where(it => descs.Contains((it.Description ?? "").Trim().ToLowerInvariant()))
                        .Select(it => new DeliveryItem
                        {
                            ItemTypeId = it.ItemTypeId,
                            Description = it.Description,
                            Quantity = deltaItems.First(d => d.Description.Trim().ToLowerInvariant() == (it.Description ?? "").Trim().ToLowerInvariant()).Quantity,
                            Unit = it.Unit,
                        }).ToList();
                    if (clonedItems.Count == 0) continue;
                    var clone = new DeliveryChallan
                    {
                        CompanyId = srcChallan.CompanyId,
                        ChallanNumber = srcChallan.ChallanNumber,
                        ClientId = srcChallan.ClientId,
                        PoNumber = srcChallan.PoNumber,
                        PoDate = srcChallan.PoDate,
                        IndentNo = srcChallan.IndentNo,
                        DeliveryDate = srcChallan.DeliveryDate,
                        Site = srcChallan.Site,
                        Status = "Invoiced",
                        IsImported = srcChallan.IsImported,
                        IsDemo = srcChallan.IsDemo,
                        DuplicatedFromId = srcChallan.DuplicatedFromId ?? srcChallan.Id,
                        SalesOrderId = null,
                        Items = clonedItems,
                        Invoice = invoice,     // nav link → EF fills InvoiceId in THIS save
                    };
                    _context.DeliveryChallans.Add(clone);
                }
            }

            await _context.SaveChangesAsync();   // ONE save: invoice + challans together
            await tx.CommitAsync();

            return await GetByIdAsync(invoice.Id);
        }
        catch (DbUpdateException) when (attempt < maxAttempts)
        {
            await tx.RollbackAsync();
            _context.ChangeTracker.Clear();
        }
    }
    throw new InvalidOperationException("Could not allocate a bill number after several attempts.");
}
```
> NOTE during implementation: confirm the exact name of the number-allocation lock (`AcquireInvoiceNumberLockAsync`), the words helper (`AmountToWords` vs inline), and `company.StartingInvoiceNumber` — copy whatever `CreateAsync`/`CreateNoteAsync` actually use. Do not invent names.
- [ ] **Step 3:** `dotnet build` → 0 errors.
- [ ] **Step 4:** Commit (ask): `Add CreateSupplementaryInvoiceAsync (delta bill + challan clone)`.

### Task 4: `POST /invoices/{id}/supplement` endpoint

**Files:**
- Modify: `Controllers/InvoicesController.cs` (next to `Reverse`/`CreateNote`)

**Interfaces:**
- Consumes: `CreateSupplementaryInvoiceDto`, `_service.CreateSupplementaryInvoiceAsync`, `_access`
- Produces: `POST /api/invoices/{id}/supplement`

- [ ] **Step 1:** Add:
```csharp
/// <summary>
/// Bill the quantity under-reported on an FBR-submitted invoice as a new
/// UNCLASSIFIED delta bill (+ cloned challan). The delta bill then flows through
/// the normal bill→tax-consultant→FBR pipeline. Gated by invoices.note.create.
/// </summary>
[HttpPost("{id}/supplement")]
[HasPermission("invoices.note.create")]
public async Task<ActionResult<InvoiceDto>> Supplement(int id, [FromBody] CreateSupplementaryInvoiceDto body)
{
    var existing = await _service.GetByIdAsync(id);
    if (existing == null) return NotFound(new { error = "Invoice not found." });
    await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
    try
    {
        var bill = await _service.CreateSupplementaryInvoiceAsync(id, body, User.Identity?.Name);
        if (bill == null) return NotFound(new { error = "Invoice not found." });
        return Ok(bill);
    }
    catch (InvalidOperationException ex)
    {
        return BadRequest(new { error = ex.Message });
    }
}
```
- [ ] **Step 2:** `dotnet build` → 0 errors.
- [ ] **Step 3:** Commit (ask): `Add POST /invoices/{id}/supplement endpoint`.

### Task 5: Backend integration test (hand off to user to run)

**Files:**
- Modify: `scripts/test_basic_flows.py`

- [ ] **Step 1:** Add a case: create + submit a bill (or use an ephemeral company like the other flow tests), call `POST /invoices/{id}/supplement` with a delta line, assert: new invoice has `NoteKind=0`, `SupplementsInvoiceId=original`, one line at delta qty, empty HSCode; a `DeliveryChallan` with the same `ChallanNumber`, `DuplicatedFromId` set, linked to the new invoice; original invoice + challan unchanged.
- [ ] **Step 2:** (User runs — needs the server.) `python scripts/test_basic_flows.py` → `all PASS`. If it can't run now, mark pending and note it in the handoff.

### Task 6: Frontend — API + minimal Correct flow

**Files:**
- Modify: `myapp-frontend/src/api/invoiceApi.js` (add `supplementInvoice(id, body)`)
- Create: `myapp-frontend/src/Components/CorrectionWizard.jsx` (Phase 1: delta entry + challan confirm + create + handoff banner)
- Modify: `myapp-frontend/src/pages/InvoicePage.jsx` (add **Correct** action for submitted bills, `has("invoices.note.create")`; keep Reverse)

**Interfaces:**
- Consumes: `POST /invoices/{id}/supplement`
- Produces: `invoiceApi.supplementInvoice`, `<CorrectionWizard invoice … />`

- [ ] **Step 1:** `invoiceApi.js`:
```js
export const supplementInvoice = (id, body) => api.post(`/invoices/${id}/supplement`, body).then(r => r.data);
```
- [ ] **Step 2:** `CorrectionWizard.jsx` (Phase 1 minimal): props `{ invoice, onClose, onCreated }`. Shows each line with billed qty + a "corrected qty" input; computes delta = corrected − billed (only lines with delta>0 are sent); a challan carry-over toggle (default on); a Create button → `supplementInvoice(invoice.id, { lines:[{invoiceItemId, quantity:delta}], carryChallan, reason })`. On success show the handoff banner ("Bill #N created — hand to the tax consultant to classify + submit") and call `onCreated`. Mobile-first grid; buttons render only with permission (parent gates).
- [ ] **Step 3:** `InvoicePage.jsx`: add a **Correct** button on FBR-submitted rows (beside Reverse), `has("invoices.note.create")`, opening `CorrectionWizard`.
- [ ] **Step 4:** Build + deploy: `cd myapp-frontend && npm run build`, then copy `dist/*` → `../wwwroot/`.
- [ ] **Step 5:** Browser-verify (Browser pane): open Bills, confirm Correct appears on a submitted bill, wizard renders at 375/768/1280, delta math correct, no console errors. Screenshot.
- [ ] **Step 6:** Commit (ask): `Add Correct action + supplementary-invoice flow (frontend)` (bundle rebuild in the SAME commit).

---

## PHASE 2 — Unified auto-routing "Correct" wizard

### Task 7: Routing engine + wizard steps

**Files:**
- Modify: `myapp-frontend/src/Components/CorrectionWizard.jsx` (grow to the 5-step wizard from the prototype)
- Modify: `myapp-frontend/src/api/invoiceApi.js` (ensure `reverseInvoice`/`createNote` present — reuse existing note endpoints)

**Interfaces:**
- Consumes: existing `POST /invoices/{id}/reverse` and `POST /invoices/notes` (Credit/Debit), plus `POST /invoices/{id}/supplement` (Task 4).
- Produces: routing `deriveInstrument(originalLines, correctedLines)` → `'credit' | 'debit' | 'supp' | 'redo'`.

- [ ] **Step 1:** Port the prototype's routing (`credit` = net decrease; `debit` = rate-up within original value; `supp` = qty increase / beyond original value; `redo` = zeroed out) into a pure `deriveInstrument` function; unit-test it in isolation if a JS test harness exists, else assert via a small inline dev check.
- [ ] **Step 2:** Steps: Diagnose → Corrected figures (live instrument badge) → Reason & tax → Delivery link → Review. On confirm, call: credit/debit → `createNote` (partial `Lines`); supp → `supplementInvoice`; redo → full `reverseInvoice` then open a fresh bill prefill.
- [ ] **Step 3:** Build + deploy + browser-verify each branch renders and calls the right endpoint (network tab). Screenshot the supp + credit paths.
- [ ] **Step 4:** Commit (ask): `Unify Correct wizard with auto-routed FBR instruments`.

### Task 8: Docs + full verification

- [ ] **Step 1:** README `## Changelog` dated entry (newest first).
- [ ] **Step 2:** Delete this plan + the spec once the feature is implemented + verified (per repo convention: done+verified feature docs are removed) — OR keep if partially done.
- [ ] **Step 3:** Full pre-push suite (user runs the server-dependent ones): `dotnet build` (0 err), `python scripts/verify_audit_2026_05_13_security.py` (67/67), `python scripts/test_basic_flows.py` (all PASS), `python scripts/test_tenant_isolation.py` (add `/supplement` case; all PASS).
- [ ] **Step 4:** Ask before push.

---

## Self-review notes
- **Spec coverage:** Phase-1 gap (delta bill + challan clone + audit link + unclassified handoff) → Tasks 1–6. Phase-2 wizard → Tasks 7–8. Credit/Debit reuse existing `CreateNoteAsync` (no new backend).
- **Open items to confirm at implementation:** exact numbering-lock/words-helper names in `InvoiceService` (Task 3 note); whether `test_tenant_isolation.py` needs a new fixture for a submitted invoice.
- **Risk:** integration tests need the server; per operator rules the user starts it. Compile + frontend/browser verified by me; DB/FBR flow verified by the user before push.
