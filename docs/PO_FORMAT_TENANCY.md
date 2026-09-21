# Company-private PO formats

PO formats belong to one company and one client in that company. The seed administrator can select every company. Other users see only companies granted through tenant access, and must also hold the corresponding PO-format view/create/update/delete permission.

## Behavior

- The page lists formats for its selected company. Changing company clears the list and closes the editor, and late responses cannot populate another company’s screen.
- The client picker returns only IDs and names from that company. It uses PO-format create/update permissions, so client-administration access is not required.
- List without a company is limited to the caller’s accessible companies. Detail, update and delete authorize the stored owner, regardless of request parameters.
- Both creation endpoints require company/client ownership. Editing cannot transfer company ownership. Client-group IDs supplied by callers are ignored; groups do not grant access or share formats.
- PDF fingerprinting and PO import require an authorized company. Exact and fuzzy matches only consider valid formats from that company. Import resolves the directly linked client, without hopping through common-client groups.
- Database writes validate company/client consistency. A filtered unique index prevents duplicate formats for a company/client pair, including concurrent saves. The initial format and its version are saved atomically.

## Upgrade

Migration `20260921131201_PrivateCompanyPOFormats` retains all existing format rows and their history. A global row with a direct client is assigned to that client’s company. A row with conflicting or missing ownership remains preserved but hidden. If several formats resolve to the same company/client, the active, most recently updated format wins (ID breaks ties); the others remain unowned and hidden. No format is copied across companies just because clients share a group.

Downgrade is deliberately blocked: restore a verified pre-upgrade backup for rollback. Unowned legacy rows require ownership review before any separate recovery/reassignment. The migration was rehearsed on a disposable local database before deployment.

## Verification

- `dotnet run --project scripts/accounting_audit_checks -c Release`: 102 checks, using a unique disposable local SQL database. Includes migration preservation, ownership validation, uniqueness, scoped matching, real permission filters and company guards with seed-admin, PO-only editor, reader and empty-role identities. The database is removed in finally.
- `npm run test:po-formats` from `myapp-frontend`: 10 component interaction tests with controlled API responses, including company switches, stale responses, permissions, client filtering, upload/save scope and failed lookups.
- Release API build, frontend production build, targeted UI lint and EF model/migration consistency checks pass.
- Full browser/HTTP testing against a running updated server remains outstanding. Automatic approval review rejected the isolated background local-server startup even after user approval, with no reason beyond "blocked by policy". Those pre-deployment checks made no production changes or FBR submissions.
