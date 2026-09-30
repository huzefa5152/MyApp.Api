# Local audit equivalence checks

Run only against the disposable local database named in Program.cs, after the API has initialized it. No production configuration or FBR network access is used.

```powershell
dotnet build scripts/audit_query_checks/audit_query_checks.csproj -p:UseAppHost=false -o .codex-audit/query-proof
dotnet .codex-audit/query-proof/audit_query_checks.dll
```

The last-rate checks roll back their fixtures. Import checks retain synthetic companies, bills and movements in this disposable database because the committer owns and commits its transaction. Do not point this harness at another database.

Legacy query and import classes are frozen from master c1597a1c. They are test oracles, not production implementations. Checks compare exact outputs, SQL query counts, stock tracking enabled/disabled, fractional quantities, mixed skip decisions, movement source references and complete invoice rollback after an injected stock-write failure.
