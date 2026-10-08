# Email workspace verification — 2026-10-08

Branch: `codex/trader-gmail-quotations`, based on `TraderFbrInvoicingSystem`.
No commit, push, merge or deployment has been performed. Master is outside
scope. The Customize port remains gated on Trader acceptance.

## Results

| Check | Actual result |
| --- | --- |
| Backend build | `0 Error(s)`; existing nullable/member warnings |
| xUnit project, Release | `Failed: 0, Passed: 18, Skipped: 0` |
| Email UI workflow tests | `Tests 4 passed (4)` |
| Frontend build | Successful; existing print-editor duplicate-key and chunk-size warnings |
| Tenant isolation, disposable SQL | `All checks passed`; email workspace `17/17 passed` |
| Basic flows, disposable SQL | `87/87 checks passed` |
| Administrator scope isolation | `127/127 checks passed` |
| Static security audit | `67/67 checks passed` |
| Route permissions | `155 passed, 0 failed` |
| Company-scoped actions | `162` checked; `every company-scoped action is guarded` |
| Production-identifier / UI-placeholder scan | Clean; also run over untracked feature files |
| EF migration on a fresh disposable SQL database | Applied through `AddEmailWorkspace` successfully |
| Browser review + connections screens | 375, 768, 1280 px: no horizontal page overflow |

The SQL integration test uses a fake Gmail provider with the real SQL database
and Sales Quote service. It proves one message across repeated syncs, one
active sync lease across overlapping callers, OAuth state user binding and
replay rejection, private versus explicitly shared company visibility,
customer-company validation, draft revisions, required human review and one
real quotation across simultaneous conversions. Expected subtotal and grand
total are verified. It does not contact Google.

Browser screenshots use synthetic email fixtures in the actual application
with its real shared line editor. They do not show a live Gmail connection.
The local machine lacks .NET 9's runtime; these local tests used the installed
.NET 10 runtime through `DOTNET_ROLL_FORWARD=Major`, still targeting net9.0.
Repeat the deployment acceptance check on the installation's supported runtime.

## Existing check failure

`python scripts/verify_permission_sections.py` reports that the existing
`Withholding Tax` module has no section mapping. The base Trader branch also
omits that mapping. The new `EmailWorkspace` module is mapped under Sales.
No assertion was changed and no unrelated module was altered to hide the failure.
The JSX files are outside the current ESLint configuration; ESLint reports
them ignored. The Vite build and Vitest tests cover compilation and behaviour.

## Acceptance still required

Create/configure the Google OAuth web client using
[the setup guide](GMAIL_EMAIL_WORKSPACE.md). Test consent, cancellation,
reconnection after revocation, arrival of a real email and attachment download.
Verify restricted-scope production requirements with Google before tenant
rollout. Older mail beyond the initial 30 days and automatic attachment/OCR
extraction are outside this implementation.

Do not describe this as live-Gmail verified or production-ready until those
checks and the retention policy are complete. Request fresh maintainer approval
before commit, push, merge or deployment. Then port the feature explicitly to
Customize with its own migration and verification; do not merge product lines.

## Approved local-copy company isolation audit (2026-10-08)

Executed `scripts/email-access-audit/EmailAccessAudit.csproj` against the maintainer-approved local Trader database copy, using its actual users, company assignments and role policy. No production server or Google API was contacted.

- Inventory: 8 users, 11 companies, 14 explicit assignments.
- Real company guard: all 88 user/company combinations passed (25 allowed, 63 denied), including the existing seed-administrator global exception.
- Email service: 1,306 assertions passed across every user/company combination, covering list/read, private versus sender-rule sharing, forged connection and message IDs, Keep/prepare/draft/convert/download boundaries, company-scoped Keep sharing and immediate assignment revocation.
- Actual endpoint authorization filters: 3,069 assertions passed across 15 endpoints, all 11 companies, all 8 existing users and anonymous requests.
- Existing role policy grants `email.inbox.view` to only the seed administrator (1 of 8 users). Other users need explicitly assigned email permissions as well as company access. No grants were added.
- Feature DDL, synthetic mail and the temporary grant revocation ran inside a transaction and were rolled back. Original assignments and migration state were verified after rollback. The feature migration remains unapplied on the copy.

The harness exercises real authorization filters in process; it does not issue live JWT HTTP requests or validate real Google consent/mail. Earlier disposable-database HTTP and conversion tests remain separate evidence. See the harness README for safe rerun instructions.

## Optional module acceptance (2026-10-08)

Email Workspace now has its own permission section, navbar group, `email.workspace.use` gate and built-in opt-in role. Sales Edition, Complete Edition, Tenant Administrator and Administrator exclude its permissions; the platform seed administrator keeps its existing global bypass. No existing user is automatically assigned the optional role. Existing Users role assignment supports both users and administrators, with the existing management and grantable-permission boundaries.

Latest verification supersedes the earlier Sales-section mapping and automatic edition inclusion:

- Backend: 20/20 tests passed, including real SQL seeding of the optional role without granting existing users, real quotation conversion and module-revocation sync denial. Seeder acceptance uses a separate disposable local database suffixed `_Module` because the full seeder owns its own transaction.
- Frontend: 9/9 tests passed, including legacy navigation without the module, separate active module navigation, no mail API requests without module/inbox access, read-only access and company switching.
- Frontend TypeScript/Vite build passed; existing print-template duplicate-style and chunk-size warnings remain.
- Approved local-copy audit: all 88 user/company combinations passed; 1,306 company/resource assertions passed before module-role revocation; 46 module-assignment/delegation assertions passed through the real user-role controller; 4,554 actual authorization-filter assertions passed across every company, existing user and anonymous requests. Removing the optional role subsequently blocked inbox and OAuth start while preserving original roles.
- The local-copy harness temporarily installs only the module permission rows and a synthetic system role, preserves existing roles when assigning it, and rolls back all fixtures, assignments and schema changes. Original role and company assignments and migration state are verified after rollback. No Google requests run.
- Tenant-scope static verification: 162 guarded actions; security audit: 67/67 passed. The existing unmapped Withholding Tax permission-section issue remains unrelated to the newly mapped Email Workspace section.

The supported-runtime and real Google OAuth acceptance requirements above remain pending. No production database, commit, push, merge or deployment was performed.
