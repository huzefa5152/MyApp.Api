# H-6 — God-file split + unit safety net (DESIGN / NOT STARTED)

**Audit ref:** `AUDIT_2026_08_02_ENTERPRISE.md` §4 H-6, §13 (Refactoring).
**Status:** design only — no code written. Multi-day, incremental. **Depends on
C-2** (the xUnit project at `tests/MyApp.Api.Tests/` — now exists) so each extraction
lands behind a test.

## Problem

A few files carry too much and are merge-conflict magnets + risky to change because
nothing catches a regression:

| File | LOC (audit) | Concerns tangled |
|---|---|---|
| `Services/Implementations/InvoiceService.cs` | ~3,350 | numbering, stock sync, FBR dual-book overlay, print-DTO assembly, CRUD |
| `myapp-frontend/src/Components/EditBillForm.jsx` | ~3,455 | line-items editor, FBR panel, totals/summary, submit flow |
| `Data/AppDbContext.cs` | ~1,258 | one giant `OnModelCreating` |
| `Program.cs` | ~1,939 | startup chain (see C-1) |

## Principle

**Behavior-preserving extraction only.** Move code behind the existing interface
(`IInvoiceService`) / component boundary; do not change contracts, HTTP shapes, or UI
behavior. One cohesive unit per PR, each with a test written **first** (the extracted
unit is now pure enough to unit-test) and the full pre-push suite green after.

## Backend target seams (InvoiceService)

Extract into focused collaborators, injected into `InvoiceService`, one per PR:

1. **Invoice numbering** → `IInvoiceNumberAllocator` (the `sp_getapplock` +
   NumberAllocationRetry logic). Pure-ish, high test value (collision/retry).
2. **Stock sync** → already partly in `IStockService`; move the invoice-side
   decisioning (overlay-qty vs row-qty) into a testable `InvoiceStockPlanner`.
3. **FBR dual-book overlay** → `IInvoiceFbrOverlay` (adjustment/reclassification math).
   Highest correctness value; pin with tests before touching.
4. **Print-DTO assembly** → `IInvoicePrintAssembler`.

Each extraction: interface + impl + DI registration + unit tests for the moved logic;
`InvoiceService` delegates. No public method on `IInvoiceService` changes.

## AppDbContext

Split the single `OnModelCreating` into per-entity `IEntityTypeConfiguration<T>`
classes (mechanical, zero behavior change; verify the model snapshot is byte-identical
via `dotnet ef migrations has-pending-model-changes` → none).

## Frontend target seams (EditBillForm.jsx)

Split into `LineItemsEditor` (reuse the shared one from the responsive sweep), an
`FbrPanel`, and a `TotalsSummary`, with the parent owning state and passing props.
Verify at 375 / 768 / 1280 px + the narrow / full / challan edit flows (DOM-measure,
per CLAUDE.md §3 — green build is not visual proof).

## Test approach

- New pure units → xUnit in `tests/MyApp.Api.Tests/` (numbering, overlay math,
  tax/total math extracted from the services).
- DB-coupled invariants stay in the Python suites (`test_stock_itemtype_reflow.py`
  140/140, `test_basic_flows.py`, `test_tenant_isolation.py`) — run every PR.
- Frontend: manual responsive + flow checks; no runner exists yet (out of scope here).

## Order (lowest risk first)

1. `AppDbContext` split (mechanical, snapshot-verifiable). 2. Invoice numbering.
3. Print-DTO assembler. 4. Stock planner. 5. FBR overlay (last — highest risk).
6. `EditBillForm` split. Program.cs is covered by C-1, not here.

## Risk

MEDIUM per extraction, and it compounds without tests — which is exactly why C-2
lands first. Never refactor a seam whose logic isn't pinned by a test in the same PR.
Keep each PR small enough to review as "obviously equivalent".
