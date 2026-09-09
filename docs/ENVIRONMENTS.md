# Environments — branches, databases, and what an agent may touch

**This file is the standard. Read it before changing anything in this
repository.** `CLAUDE.md` points here; nothing below is optional.

One codebase serves **three separate production installations** on MonsterASP.
They are not stages of one pipeline — they are three different customers'
systems, each with its own live database, its own deploy workflow, and its own
long-lived branch. A fourth branch carries security/audit work that is ahead of
`master`.

---

## 1. Branch policy

Exactly four branches are valid, locally and on `origin`:

| Branch | Role | Deploy workflow | Local database |
|---|---|---|---|
| `master` | **Production #1** | `.github/workflows/deploy.yml` | `MyApp_Master_Local` |
| `customize-solution-for-other` | **Production #2** | `.github/workflows/deploy-other.yml` | `MyApp_Customize_Local` |
| `feat/importer-ledger-receipts` | **Production #3** (the current importer line) | `.github/workflows/deploy-importer.yml` | `MyApp_Importer_Local` |
| `fix/audit-2026-08-02` | Audit / security fixes, **ahead of `master`** — not a production environment | none (merged into `master` when accepted) | `MyApp_Master_Local` |

Each production workflow triggers on a push to its own branch, so **a push to
any of the three deploys a real customer's system.** Confirm with the maintainer
before every push.

Rules:

- **Do not create long-lived branches.** A short-lived `fix/…` or `feat/…`
  branch for one piece of work is fine; delete it as soon as the work has
  landed. Anything still around after that is cleanup debt.
- **Do not rename these four branches.** The deploy workflows key off the branch
  name, and the importer branch name is embedded in `deploy-importer.yml`.
- **Do not delete a branch that has unique commits.** Check with
  `git rev-list --count <branch> ^master ^customize-solution-for-other ^feat/importer-ledger-receipts ^fix/audit-2026-08-02`
  before removing anything; `0` means every commit is already preserved.
- Commit identity for this repo is the **personal** GitHub account — see the
  Git workflow section of `CLAUDE.md`. It is set repo-local, so it covers every
  branch automatically.

### 1a. The three lines are NOT to be silently merged

`master`, `customize-solution-for-other` and `feat/importer-ledger-receipts` are
three deployed products that happen to share ancestry. They have deliberately
diverged: the customize and importer sites serve the ERP under `/admin/` with a
landing page at `/`, master serves it at the root, and the schemas differ by
dozens of migrations (see §3).

So:

- A change asked for on one branch **stays on that branch** unless the
  maintainer asks for it to be ported.
- Never "tidy up" by merging one production line into another.
- **Security and audit fixes are the exception that still needs a decision** —
  they usually SHOULD reach all three, but each port is a deliberate act with
  its own review, not an automatic merge.
- When porting, cherry-pick the specific commits and say in the message that it
  is a port. A cherry-pick keeps the ORIGINAL author, so follow it with
  `git commit --amend --reset-author` when the branch's authorship should be
  uniform.

---

## 2. Local database policy

Every branch runs against **its own local restored copy** of that environment's
production database. Nothing local ever talks to a production server.

| Branch | Local database | Restored from |
|---|---|---|
| `master` | `MyApp_Master_Local` | `…\Database Backup\master\<master-prod-db>_custom_*.bak` (prod DB `<master-prod-db>`) |
| `customize-solution-for-other` | `MyApp_Customize_Local` | `…\Database Backup\customize\<customize-prod-db>_custom_*.bak` (prod DB `<customize-prod-db>`) |
| `feat/importer-ledger-receipts` | `MyApp_Importer_Local` | `…\Database Backup\importer\<importer-prod-db>_custom_*.bak` (prod DB `<importer-prod-db>`) |
| `fix/audit-2026-08-02` | `MyApp_Master_Local` | same backup as `master` |

Backup root on the maintainer's machine:
`C:\Users\hussahuz\Downloads\Database Backup\{master,customize,importer}`

**`<…-prod-db>` is a placeholder on purpose — do not fill it in.** The
production databases sit on a public host whose subdomain IS the database
name, and the SQL username is the database name too — so writing the real
name in a public repository gives away two thirds of a credential. The real names live in the gitignored
`production.databases.json`, and `RESTORE FILELISTONLY` reads them straight out
of any backup you actually hold.

Local SQL Server instance: **`.\MSSQLSERVER02`** (SQL Server 2025, 17.0).
That instance is not a preference — the production backups are taken on SQL
Server 2025 (`SoftwareVersionMajor 17`, internal database version 998), so the
2019 and 2022 instances on this machine **cannot restore them at all**. Data and
log files live under `D:\SqlData\MyAppLocal\` (C: is nearly full).

### 2a. How the branch picks its database

`Helpers/LocalDevDatabase.cs` reads the current branch straight out of
`.git/HEAD` at startup and looks it up in **`local.databases.json`** at the repo
root. Checking out a branch is the entire switch — there is no file to edit, no
script to run, and nothing to remember.

Precedence, highest first:

1. `ConnectionStrings__DefaultConnection` environment variable (and the command
   line) — how the python test scripts aim at a scratch database.
2. **The branch map** (`local.databases.json`, overlaid by the gitignored
   `local.databases.local.json`).
3. `appsettings.Development.json` — gitignored, holds `Jwt:Key`.
4. `appsettings.json`.

The map deliberately beats `appsettings.Development.json`: a stale connection
string in a gitignored file surviving a branch switch is exactly the accident
this exists to prevent.

Two conditions gate the whole mechanism, and a deployed site meets neither:

- `ASPNETCORE_ENVIRONMENT` must be `Development`; **and**
- a `.git` directory must exist above the content root.

`MyApp.Api.csproj` also removes `local.databases*.json` from the publish output,
so the file cannot even reach a server.

The map holds **no secret** — every entry is Windows-authenticated against a
local instance — which is why it is tracked in git and identical on all four
branches. Keeping it identical is what stops it conflicting on every merge and
cherry-pick between the three production lines.

Startup says which database it picked:

```
Local database selected from branch feat/importer-ledger-receipts: .\MSSQLSERVER02 / MyApp_Importer_Local
```

If a branch has no entry, the app logs a warning, applies no override, and falls
back to `appsettings` — it never guesses. Add the branch to `local.databases.json`
(or rely on the `master-*` / `customize-*` / `importer-*` wildcards).

### 2b. Another machine

Create `local.databases.local.json` next to `local.databases.json`. It is
gitignored, has the same shape, and merges field by field, so usually one line
is enough:

```json
{ "server": "MY-BOX\\SQLEXPRESS" }
```

### 2c. Restoring a fresh production backup

SQL Server runs as `NT Service\MSSQL$MSSQLSERVER02` and cannot read
`C:\Users\<you>\Downloads`, so stage the file somewhere the service account can
reach (`C:\Users\Public\SqlRestoreStaging` is used here) before restoring:

```sql
RESTORE FILELISTONLY FROM DISK = N'C:\Users\Public\SqlRestoreStaging\<file>.bak';

RESTORE DATABASE [MyApp_Master_Local]
FROM DISK = N'C:\Users\Public\SqlRestoreStaging\<file>.bak'
WITH MOVE N'<master-prod-db>'     TO N'D:\SqlData\MyAppLocal\MyApp_Master_Local.mdf',
     MOVE N'<master-prod-db>_log' TO N'D:\SqlData\MyAppLocal\MyApp_Master_Local_log.ldf',
     RECOVERY, STATS = 25;
```

The logical file names inside the backup are the **production** database names
(`<master-prod-db>`, `<customize-prod-db>`, `<importer-prod-db>`) — always read them from `FILELISTONLY` rather
than assuming, and always `MOVE` them to the local path so nothing lands on a
production file location. Use `WITH REPLACE` only when you intend to overwrite
the existing local copy.

`Database:AutoMigrate` defaults to `true`, so the first local run of a branch
brings its restored copy up to that branch's migrations.

---

## 3. Schema is per environment

The three databases are at genuinely different schema levels, which is another
reason they are never interchangeable:

| Local database | Tables | Last applied migration |
|---|---|---|
| `MyApp_Master_Local` | 47 | `20260903183946_AddInvoiceFbrCancelled` |
| `MyApp_Customize_Local` | 63 | `20260902084604_WidenPriceAndQuantityTo12Decimals` |
| `MyApp_Importer_Local` | 68 | `20260908155639_AddCompanyInventoryOverlay` |

Each matches the last migration on its branch exactly.

**Known drift on the audit branch.** `fix/audit-2026-08-02` and `master` differ
by one migration each way:

- audit has `20260802200706_AddDateRangeIndexes`, master does not;
- master has `20260903183946_AddInvoiceFbrCancelled`, audit does not.

Running the audit branch against `MyApp_Master_Local` therefore adds the index
migration to that database. It is additive (indexes only) and EF ignores a
history row it does not recognise, so `master` keeps working afterwards. If you
would rather keep them completely apart, restore the master backup a second time
as `MyApp_Audit_Local` and change the one line in `local.databases.json`.

---

## 4. Local vs production

```
Local development      Application  ->  LOCAL restored database        (read/write)
Production diagnosis   SQL client   ->  REMOTE production database     (READ ONLY)
Never                  Application  ->  REMOTE production database
```

`Helpers/DevelopmentSqlGuard.cs` enforces the third line. When
`ASPNETCORE_ENVIRONMENT=Development`, the app refuses to start if
`ConnectionStrings:DefaultConnection` names a server that is not this machine.
It is an **allowlist** (`.`, `(local)`, `localhost`, `127.0.0.1`, `::1`,
`(localdb)\…`, and the machine's own name) rather than a list of known
production hosts, because a blocklist silently passes whichever host nobody
remembered to add.

The guard runs only in Development, so production deploys are untouched.

For an approved diagnostic session that really must point the app elsewhere:

```
LocalSafety__AllowRemoteSqlInDevelopment=true
```

Loud, temporary, and typed on purpose. Do not put it in a settings file.

---

## 5. Production database access — READ ONLY

Read-only credentials for the three production databases will be added later.
When they are:

- Put them in **`production.databases.json`** at the repo root. It is
  **gitignored**; `production.databases.example.json` is the tracked template.
- They are for a **SQL client** (sqlcmd, SSMS, Azure Data Studio). They are
  **not** a connection string for the running application, and
  `DevelopmentSqlGuard` will refuse to start the app on one.

Permitted against production: `SELECT`, reading schema metadata, `SHOWPLAN`-style
inspection, comparing data between environments.

**Never, without an explicit written override from the maintainer:**

`INSERT` · `UPDATE` · `DELETE` · `MERGE` · `TRUNCATE` · `ALTER` · `DROP` ·
`CREATE` · `EXEC` of any procedure that may mutate state · EF migrations ·
any automated test that writes.

Production is for investigating real data, diagnosing a reported problem,
comparing behaviour between the three installations, and understanding schema
differences. Nothing else.

If a fix needs a data change in production, write the statement, show it to the
maintainer, and let them run it.

---

## 6. Checklist when picking up work

```
git rev-parse --abbrev-ref HEAD      # which production line am I on?
git config user.email                # must be the 45231321+huzefa5152 address
```

Then start the app and read the startup line that names the database. If it does
not name the database this file maps to that branch, stop and find out why
before touching anything.
