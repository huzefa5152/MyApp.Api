# Trader MCP — agent tokens, write tools and the activity log

Status: design, Trader line only. The read-only endpoint (`POST /mcp`) is live.
This document fixes what the write phases may and may not do, so each phase can
be reviewed against it.

## Goal

An operator tells an LLM "make a quotation for this client from this email" or
"raise a challan for these items". The LLM calls MCP tools. The ERP does the
work through the SAME services the web screens use, and records what the agent
did, for whom, and with which result. Nothing an agent does may exceed what its
owner could do by hand.

## Decisions (defaults; change by saying so)

1. **Writes are two steps.** `prepare_*` validates, prices and stores a plan;
   `commit_action(planId)` executes it. The host's confirmation prompt guards
   `commit_action`; a plan id is NOT proof of human consent, so the token flag
   `AllowWrites` is off by default and `AutoCommit` is a separate, off-by-default
   flag the seed admin sets per token, and never covers challans or bills.
2. **Out of MCP, always:** FBR validate / submit, voiding or deleting a document,
   credit and debit notes, users, roles, company settings and FBR tokens, SQL,
   arbitrary URLs. These stay manual. Adding one later is its own reviewed change.
3. **Per-agent tokens.** Opaque `tmcp_…` secret, shown once, stored as a SHA-256
   hash. Bound to one user. Carries: company allow-list (subset of the user's own
   companies), scopes, `AllowWrites`, `AutoCommit`, expiry (max 90 days), revoke.
   Effective access = the user's access ∩ the token's limits; the stricter wins.
   The login JWT keeps working for read-only use.
4. **Everything is logged, reads included**, in an append-only `McpActivities`
   table: when, agent token, user, tool, company, redacted arguments, outcome,
   resulting document id, duration. No update or delete path exists in the API.
   Seed admin sees all; a tenant administrator sees rows for their own companies.
5. **Idempotency.** Create tools take an optional `idempotencyKey` (an email
   message id, for instance). Replaying the same key for the same token returns
   the original result instead of creating a second document.
6. **Services, not copies.** Tools call `IClientService`, `ISalesQuoteService`,
   `IDeliveryChallanService`, `IInvoiceService`. Number allocation, tenant
   guards, stock reflow and the rest stay exactly as the screens have them.

## Phases (each ends in a commit and a green test run; no push without a go)

| Phase | Delivers |
|---|---|
| 1 | `McpAgentTokens` + `McpActivities` tables, token auth on `/mcp`, token limits enforced, activity logging for every call, admin endpoints and screen (create / revoke token, activity feed), tests |
| 2 | Clients: `prepare/commit` create and update. Quotations: prepare/commit create. Plan store (`McpPendingActions`), idempotency |
| 3 | Delivery challans and bills (from a challan, standalone): prepare/commit, stock and numbering through the real services |
| 4 | Accounts and receipts: reads first (ledger, trial balance, balances), writes only if asked |

## Safety invariants (each has a test)

- A token cannot reach a company outside its list, nor one its user cannot reach.
- A read-only token cannot prepare or commit anything.
- A plan belongs to one token, expires in 10 minutes, executes once, and is
  re-validated at commit (permissions, company access, numbering) — not trusted.
- A revoked, expired or deleted token fails on its very next call.
- Every call, allowed or refused, leaves an activity row; a refused call records
  the reason. Arguments are redacted by `SensitiveDataRedactor`.
- Tool output is data, never instructions.
