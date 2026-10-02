# Hosted MCP: connecting AI tools to Trader

The Trader site exposes a Model Context Protocol endpoint at `https://<your-site>/mcp`
(Streamable HTTP, stateless). An AI tool connected to it acts as ONE signed-in user and can
do only what that user could do by hand, inside the companies chosen for the connection.
Replace `<your-site>` with the site's origin. Never commit the real host, a token or a
password.

## What an agent can do

**Look things up (always):** `list_companies`, `search_clients`, `search_invoices`,
`get_invoice`, `get_stock`, `search_quotes`, `search_challans`, `get_challan`, and five report
tools that answer questions about your data: `sales_summary`, `outstanding_ledger` (one client's
statement with ageing), `receivables_by_client` (who owes you most), `tax_sheet_summary` (lines
still missing an HS code) and `item_rate_history` (what an item was billed at before). Each runs
the same report as its screen, needs that screen's permission, and returns a bounded summary.

**Create records (opt-in, per token):**

| Scope | Tools | Needs |
|---|---|---|
| `clients.write` | `prepare_client` (create or update) | `clients.manage.create` / `.update` |
| `quotes.write` | `prepare_quote` | `salesquotes.manage.create` |
| `challans.write` | `prepare_challan` | `challans.manage.create`, `challans.list.view` |
| `bills.write` | `prepare_bill` (from challans, or standalone) | `bills.manage.create` and/or `bills.manage.create.standalone`, `challans.list.view` |

Writes are two steps. `prepare_*` validates and prices a plan and saves **nothing**;
`commit_action(planId)` then runs it once, through the same service the web screen uses,
only after a person approved it. `cancel_action` discards a plan.

A bill takes the next number of the company's legal invoice sequence and may reduce stock, so
a token may commit at most 10 bills and 30 challans per hour, and a challan is billed in full
or not at all (every line priced). Bills are never dated in the future and are never submitted
to FBR. FBR submission, voiding, deleting, credit and debit notes, users, roles and company
settings are not exposed through MCP at all.

## What keeps it safe

- **Acts as the user.** Every call re-applies the user's permissions and company access.
- **Narrowed, never widened.** A token names its companies and scopes; the stricter of the
  user's access and the token's limits wins.
- **Two opt-in roles, owned by the platform admin.** `MCP Access` lets a user connect at all;
  `MCP Write` additionally lets their agents create records. Neither edition carries them.
  A tenant administrator can hand them on only if they hold them.
- **Plans are single-use.** A plan lasts ten minutes, belongs to one token, and every gate is
  checked again at commit. A repeated `idempotencyKey` returns the original plan or result,
  so an email processed twice creates one quotation.
- **Everything is logged**, refused calls included, in an append-only activity table (who,
  which agent, tool, company, redacted arguments, outcome, the document produced). The seed
  admin sees all of it under Users, AI agents; each user sees their own under My Profile,
  MCP & AI.
- **Secrets are shown once** and stored as hashes. Revoking, expiring, deleting the user or
  withdrawing the role ends a connection on its very next call.

## Primary admin: switching MCP on for a tenant

1. **Create the tenant administrator** (Users, New): roles `Tenant Administrator` + an
   edition (`Sales Edition` or `Complete Edition`) + `MCP Access`, and add `MCP Write` if the
   tenant's agents may create records. Grant only that tenant's companies.
2. **The tenant administrator creates staff** with an edition role + `MCP Access` (+ `MCP
   Write` for those who may write) and only the companies each person should reach. For a
   narrower agent, build a private role from just the keys needed.
3. **Use a dedicated user per person or purpose.** Never connect the primary admin: it sees
   every company in every tenant, so MCP refuses it.
4. **Optional:** under Users, AI agents, create a token for a user yourself (choose the
   user, the companies, the scopes, the lifetime).
5. Revoke any time: revoke the token, remove the role, remove a company, or delete the user.

## Each user: connect an AI tool

Open **My Profile, MCP & AI**. It says whether MCP is enabled for you and gives copy-ready
steps for each tool. There are two ways to connect:

**Sign in (no token to paste), for claude.ai, ChatGPT and any tool that supports MCP sign-in.**
Add `https://<your-site>/mcp` as a custom connector. The tool sends you to this site, you sign
in with your ERP login, tick the companies and any extra abilities, and approve. Disconnect by
revoking the "(sign-in)" token on the same page. This is OAuth 2.1 with PKCE and dynamic client
registration; discovery is at `/.well-known/oauth-protected-resource`.

**Paste a token (Codex, Claude Code, Claude Desktop).** Create a token on the same page, then:

```toml
# Codex: ~/.codex/config.toml (token in the TRADER_MCP_TOKEN environment variable)
[mcp_servers.trader]
url = "https://<your-site>/mcp"
bearer_token_env_var = "TRADER_MCP_TOKEN"
```

```bash
claude mcp add --transport http --scope user trader https://<your-site>/mcp \
  --header "Authorization: Bearer <your token>"
```

Claude Desktop needs Node.js and the `mcp-remote` bridge; the exact config is on the page.

Check it works by asking the tool to list your companies. Only your own should appear.

## Operating notes

- Tokens are `tmcp_...` (agent) and sign-in connections renew with `tmcr_...`; both are
  accepted on `/mcp` only, and an agent token cannot create more tokens.
- The activity log is never edited or deleted by the application; no endpoint offers to.
- Verify with `python scripts/test_mcp_isolation.py`, `test_mcp_agent_tokens.py`,
  `test_mcp_self_service.py`, `test_mcp_oauth.py`, `test_mcp_writes.py` and
  `test_mcp_documents.py` against a local backend. Design record: `docs/MCP_WRITE_DESIGN.md`.
