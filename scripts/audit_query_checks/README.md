# Local audit equivalence checks

Run only against the disposable local database named in Program.cs, after the API has initialized it. No production configuration or FBR network access is used.

```powershell
dotnet build scripts/audit_query_checks/audit_query_checks.csproj -p:UseAppHost=false -o .codex-audit/query-proof
dotnet .codex-audit/query-proof/audit_query_checks.dll
```

The last-rate checks roll back their fixtures. Import checks retain synthetic companies, bills and movements in this disposable database because the committer owns and commits its transaction. Do not point this harness at another database.

Legacy query and import classes are frozen from Trader 17e7517. They are test oracles, not production implementations. Checks compare exact outputs, SQL query counts, stock tracking enabled/disabled, fractional quantities, mixed skip decisions, movement source references and complete invoice rollback after an injected stock-write failure.

The catalog-scope check reproduces the legacy foreign-company HS failure and requires the corrected committer to reuse only its company's item, create a private item when only a foreign match exists, preserve oldest same-company selection, and reject foreign suppliers atomically. Final local execution passed these checks, along with import equivalence and injected stock-write rollback.

Ledger checks use independent SQL connections to verify concurrent ordinary transactions, exclusive rebuild/read coordination, cancellation and lock release, prevention of late lock upgrades, rollback after injected journal failure, and rebuild inside a backfill-style outer transaction. The API regression in scripts/test_ledger_rebuild_concurrency.py uses two local processes sharing the disposable database and independently checks the expected ledger total.
