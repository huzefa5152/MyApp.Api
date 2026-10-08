# Email company-access audit

Run this only against a local database the maintainer has explicitly approved for tests. Supply its connection string through `EMAIL_AUDIT_CONNECTION`; do not save credentials in this project.

```powershell
$env:EMAIL_AUDIT_CONNECTION = 'Server=<local-instance>;Database=<approved-local-copy>;Trusted_Connection=True;TrustServerCertificate=True'
dotnet run --project scripts/email-access-audit/EmailAccessAudit.csproj -c Release
```

The harness uses the real `CompanyAccessGuard`, role permission service, endpoint authorization filters and email workspace service. It enumerates all existing users and companies, tests explicit assignments, injects synthetic private and shared email fixtures, attacks foreign message/connection IDs, checks Keep sharing and revocation, then rolls everything back. Feature tables are created transactionally when absent; no migration history is advanced. Existing passwords and business documents are untouched. A temporary optional module role and missing permission rows are created inside the transaction, assigned through the real user-role controller while preserving original roles, then removed. Original role assignments are verified after rollback. One existing company grant is temporarily revoked inside the rollback transaction to test immediate denial.

The seed administrator (ID 1, the application default) follows the existing global-access policy. Other users require explicit assignments. Service isolation assertions deliberately run even for users without email permissions, so a missing permission cannot conceal a company leak. After module assignment, the actual controller authorization filters are exercised for existing users and anonymous requests against every company. This is an in-process filter/service audit, not a live JWT or Google OAuth test.

The Gmail provider throws on every external operation. Application startup and background workers do not run. Avoid concurrent use of the copy during the audit because transactional schema changes may hold locks. The local runtime can require `DOTNET_ROLL_FORWARD=Major` when .NET 9 is absent; repeat release acceptance on the supported runtime.
