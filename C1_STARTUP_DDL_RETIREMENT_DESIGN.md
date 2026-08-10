# C-1 — Startup live-DDL chain retirement (DESIGN / NOT STARTED)

**Audit ref:** `AUDIT_2026_08_02_ENTERPRISE.md` §3 C-1 (Critical).
**Status:** design only — no code written. Multi-day, HIGH regression. Must not
be started without the confirm-before-retire step below, and ideally only after
C-2 (CI test gate) is live.

## Problem

`Program.cs` runs ~30 raw-SQL / migration statements on **every boot** inside the
outer `try { … app.Run(); }`. Any single `ExecuteSqlRaw` that throws (lock timeout
on an `ALTER`/`CREATE INDEX`, deadlock, transient error against the remote
MonsterASP DB) is caught, logged `Fatal`, and `app.Run()` is never reached →
process exits → **site down**. Several blocks run unconditionally, so restart
fragility scales with block count × remote-DB latency.

## Goal

A healthy boot does **near-zero DB work**: schema changes live in ordered EF
migrations, and the residual idempotent seeders are gated behind a single
schema-version marker so they are skipped once applied. No behavior change to a
freshly-provisioned or already-migrated environment.

## Current inventory (confirm against source before acting)

**A. Idempotent data backfills — already gated on an AuditLog `*_V1` marker.**
These are the safe ones to retire: each writes a completion row and self-skips.
Confirm the marker is present in **every** environment, then delete the block.

| Marker (`AuditLogs.ExceptionType`) | Block |
|---|---|
| `SANDBOX_SNTAG_BACKFILL_V1` | Program.cs ~629 |
| `BILL_CHALLAN_SYNC_BACKFILL_V1` | ~1018 |
| `COMMON_CLIENTS_BACKFILL_V1` | ~1146 |
| `FBR_HS_UOM_BACKFILL_V1` | ~1285 |
| `HANDOVER_BACKFILL_V1` | ~1351 |
| `FBR_SUBMITTEDAT_VALIDATE_FIX_V1` | ~1380 |
| `COMMON_SUPPLIERS_BACKFILL_V1` | ~1404 |
| `INVOICEITEMADJ_SCOPE_NARROW_V1` | ~1503 |
| `ADJUSTEDLINETOTAL_SNAPSHOT_BACKFILL_V1` | ~1573 |
| `STOCKMOVEMENT_OVERLAY_SYNC_V1` | ~1617 |
| `RBAC_USERCOMPANIES_BACKFILL_V1` | ~1701 |

**B. DDL blocks — schema mutations that belong in EF migrations.**
Unique-index drop/recreate (~524–573), `SecurityStamp` add/update/alter
(~591–611), Units UOM reseed (~703–776), the 8+ permission-migration blocks
(~800, 824, 864, 889, 926, …). These have NO marker; they rely on `IF NOT EXISTS`
guards and re-run every boot.

**C. Bootstrap guards — keep, but make them cheap.**
RBAC bootstrap gates on `UserRoles.Any()`; permission-catalog upsert. These must
stay (a truncated AuditLogs table must not re-grant Administrator), but should sit
behind the single version gate so a healthy boot runs one cheap check.

## Method (per block)

1. **Confirm applied-state per environment (READ-ONLY).** Before retiring a group-A
   block, confirm its marker exists in prod. Run this **read-only** query against
   each live DB (Hakimi/Roshan on `master`; customer prod on `customize-…`):
   ```sql
   SELECT ExceptionType, MIN(Timestamp) AS FirstRun
   FROM AuditLogs
   WHERE ExceptionType IN ('SANDBOX_SNTAG_BACKFILL_V1', 'BILL_CHALLAN_SYNC_BACKFILL_V1', /* … all A markers … */)
   GROUP BY ExceptionType;
   ```
   A marker present in every environment ⇒ that backfill is done everywhere ⇒
   safe to delete. A missing marker ⇒ **do not retire**; a tenant hasn't hit it and
   deleting re-opens the original bug. (Prod is read-only for Claude — the operator
   runs this and pastes the result.)
2. **Group A (backfills):** once confirmed everywhere, delete the block. No
   migration needed — the data change already happened.
3. **Group B (DDL):** author a proper EF migration for the schema change (see the
   `AddDateRangeIndexes` precedent + the design-time-factory / manual-apply notes in
   memory). Remove the raw block only after the migration is applied to every DB and
   its `__EFMigrationsHistory` row confirmed present.
4. **Single version gate:** introduce one `SCHEMA_SEED_VERSION` marker (an AuditLog
   row or a tiny `AppMeta` table). Wrap the residual group-C seeders in
   `if (currentVersion < N) { … ; writeVersion(N); }` so a healthy boot does one
   cheap read and no DDL.
5. **Move the chain out of the fatal path:** whatever residual seeding remains should
   run in a way that a transient failure does **not** prevent `app.Run()` — e.g. a
   `IHostedService` that logs and lets the app serve, rather than the inline
   `try { seed…; app.Run(); }` where a seed throw kills the process.

## Phasing (each independently shippable, own PR, own verification)

- **C-1a** Retire confirmed group-A backfills (lowest risk; pure deletion after
  read-only confirmation).
- **C-1b** Fold group-B DDL into migrations, one migration per concern.
- **C-1c** Introduce the single version gate; wrap residual seeders.
- **C-1d** Move residual seeding off the fatal boot path.

## Verification (per phase)

- `dotnet build` 0 err; `dotnet test` green (C-2 suite).
- Boot against the db46684 replica: app serves, no `Fatal`, expected markers present.
- `test_stock_itemtype_reflow.py` 140/140, `test_basic_flows.py`, `test_tenant_isolation.py`.
- **Second boot** does near-zero DB work (verify via EF/SQL logging — the whole point).
- Rollback: each phase is a revert of its own PR; group-A deletions are recoverable
  from git; no data is destroyed (backfills already ran).

## Risk

HIGH. The chain touches auth (SecurityStamp), RBAC bootstrap, permission catalog,
and cross-tenant backfills. Mis-retiring a block a tenant hasn't applied re-opens the
original bug. Never retire on assumption — only on a confirmed marker per environment.
