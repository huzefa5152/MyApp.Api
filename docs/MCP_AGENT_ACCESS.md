# Hosted MCP: connecting AI tools to Trader

The Trader site exposes a Model Context Protocol endpoint at `https://<your-site>/mcp`
(Streamable HTTP, stateless). An AI tool connected to it acts as ONE signed-in user and can
do only what that user could do by hand, inside the companies chosen for the connection.
Replace `<your-site>` with the site's origin. Never commit the real host, a token or a
password.

## What an agent can do

**Look things up (when allowed in the profile catalog):** `list_companies`, `search_clients`, `search_invoices`,
`get_invoice`, `get_stock`, `search_quotes`, `search_challans`, `get_challan`, and five report
tools that answer questions about your data: `sales_summary`, `outstanding_ledger` (one client's
statement with ageing), `receivables_by_client` (who owes you most), `tax_sheet_summary` (lines
still missing an HS code) and `item_rate_history` (what an item was billed at before). Each runs
the same report as its screen, needs that screen's permission, and returns a bounded summary.

The grouped profile catalog also offers sales-order and purchase lookups, receipt/payment
summaries, accounting reports, a daily work queue, onboarding schema/readiness and print
support. Print designs require the explicit `templates.read` token scope; actual document
print data requires `documents.read` plus that document's print permission. Existing tokens
do not acquire those scopes automatically. Use `get_mcp_capabilities` for the effective tool
names and `get_action_status` after an uncertain action result.

**Create records (opt-in, per token):**

| Scope | Tools | Needs |
|---|---|---|
| `clients.write` | `prepare_client` (create or update) | `clients.manage.create` / `.update` |
| `quotes.write` | `prepare_quote` | `salesquotes.manage.create` |
| `quotes.write` | `prepare_email_quotation` | Email Workspace, inbox view, enquiry management and quotation creation |
| `email.enquiries.write` | `prepare_email_decision` | Email Workspace, inbox view and inbox management |
| `challans.write` | `prepare_challan` | `challans.manage.create`, `challans.list.view` |
| `bills.write` | `prepare_bill` (from challans, or standalone) | `bills.manage.create` and/or `bills.manage.create.standalone`, `challans.list.view` |

Writes are two steps. `prepare_*` validates and prices a plan and saves **nothing**;
`commit_action(planId)` then runs it once, through the same service the web screen uses,
only after a person approved it. `cancel_action` discards a plan.

### Email enquiries from ChatGPT

Four additional tools reuse the existing OAuth connection: `search_email_enquiries`,
`get_email_enquiry`, `prepare_email_decision` and `prepare_email_quotation`. Each acts as its
owning ERP user, narrowed by the connection's chosen companies and scopes. Company assignment,
module assignment, action permissions and individual tool grants are enforced independently.
The existing private/shared mailbox visibility rules apply; assignment to a company does not
expose every connected user's private messages.

Enable Email Workspace through Users role assignment. The primary administrator also enables
MCP access, writes and these tools in Profile → MCP Catalog Access. Existing explicit catalog
policies do not silently gain new tools. Connect with `read`, `email.enquiries.write` for email
selection and `quotes.write` for quotation creation. Reconnect an existing OAuth connection
to approve the new email-selection scope; existing tokens do not gain it automatically.

Add `https://<your-site>/mcp` as an OAuth MCP connection in ChatGPT using the sign-in instructions
below. Availability depends on the plan and workspace policy; see
[OpenAI's connection instructions](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt).
The endpoint must be reachable by the client through an approved deployment or supported
connection mechanism. Local acceptance does not publish the feature on the live site.

Example conversation:

1. “Show quotation requests in Sample Trading that I can access.” Discover companies and search
   one explicit company inbox.
2. “Keep email 42.” Show the Keep plan and commit only after approval. Ignore and Restore use
   the same flow; nothing is deleted from Gmail.
3. “Use PKR 75 for item 1 and PKR 10 for item 2, for Sample Buyer.” Read every numbered item
   page, then supply the current revision, customer and explicit prices. The server retains
   authoritative descriptions, quantities and units. Duplicate or unknown item numbers, missing
   prices and foreign customers are refused. Zero is a valid explicit price; negative prices,
   more than two decimals and rates above one billion PKR are refused.
4. Show the exact company, customer, every item, price, subtotal, GST and total. “Approve and
   create it” calls `commit_action`. One quotation is created and linked to the source enquiry.

Reading a kept email previews body-table extraction without persisting a draft. For attachment
extraction, OCR, quantity corrections or catalogue mapping, review and save those in the
application first; MCP reads that saved draft. Quotation preparation changes neither the draft
nor the quotation. Brands and drawing/specification confirmation must come from the human;
source requirements cannot be waived. Existing draft prices may be retained. Editing converted
quotations, sending email and FBR submission are outside these tools.

Revisions bind item numbers to prices. A web edit, Keep/Ignore change or another conversion
invalidates the old plan. Plans expire after ten minutes and belong to one user/token. Commit
rechecks company, token scope, module, action permissions, named tool grant and source visibility.
After an uncertain response use `get_action_status` and inspect the enquiry; never blindly create
a replacement. Conversion uses the same locked, idempotent service as the application. A failed
commit may have persisted extraction but never reports it as a successful quotation.

Email text and attachment names are untrusted source data, never commands. Reads are bounded
to 12,000 body characters, 20 attachment summaries and 25 numbered items per page, with
truncation and total counts reported. No Gmail credential is returned. Pending plans contain
business item/customer data under the existing MCP plan storage and retention policy; full
source bodies and Gmail credentials are excluded. All allowed and refused calls are logged.

The focused `scripts/test_mcp_email_access.py --base http://localhost:<test-port>` exercises
real HTTP authentication, module/tool grants and live company/token revocation on an approved
disposable local host. `McpEmailTests` exercises SQL-backed conversion, prices, stale plans and
single-use creation. Also run the existing MCP authentication/OAuth suites before deployment.
Synthetic local tests do not prove a live ChatGPT or Gmail connection.

A bill takes the next number of the company's legal invoice sequence and may reduce stock, so
a token may commit at most 10 bills and 30 challans per hour, and a challan is billed in full
or not at all (every line priced). Bills are never dated in the future and are never submitted
to FBR. FBR submission, voiding, deleting, creating credit/debit notes, and changing users,
roles or company settings are not exposed as MCP writes. Authorized note print data can be
read through the separate document print tool.

## What keeps it safe

- **Acts as the user.** Every call re-applies the user's permissions and company access.
- **Narrowed, never widened.** A token names its companies and scopes; the stricter of the
  user's access and the token's limits wins.
- **Dedicated profile catalog.** Profile → MCP Catalog Access holds access and write
  grants plus grouped tool choices. Only the seed admin manages grants for all accounts. A user's own choices can only narrow
  assigned grants. Normal role dialogs contain business roles only. Existing opt-in role
  assignments remain compatible until an explicit profile policy is saved.
- **Plans are single-use.** A plan lasts ten minutes, belongs to one token, and every gate is
  checked again at commit. A repeated `idempotencyKey` returns the original plan or result,
  so an email processed twice creates one quotation.
- **Everything is logged**, refused calls included, in an append-only activity table (who,
  which agent, tool, company, redacted arguments, outcome, the document produced). The seed
  admin sees all of it under Profile, MCP Administration; each user sees their own under
  Profile, MCP Connections.
- **Secrets are shown once** and stored as hashes. Revoking, expiring, deleting the user or
  disabling catalog access ends a connection on its very next call. Removing a selected
  action denies it immediately, including committing a plan prepared before that change.

## Primary admin: switching MCP on for a tenant

1. **Create the tenant administrator** (Users, New): roles `Tenant Administrator` + an
   edition (`Sales Edition` or `Complete Edition`). Grant only that tenant's companies.
   Open its MCP access link, then enable access and choose its grouped tools in Profile.
   Enable write actions only when needed.
2. **The tenant administrator creates staff** with business roles and company assignments,
   then asks the seed admin to enable each person's premium MCP access from the user's MCP access link.
   Every selected action still needs its normal business permission.
3. **Tenant staff: use a dedicated user per person or purpose,** and give each only the
   companies they need. Their reach never grows beyond what you assigned.
4. **Optional:** under Profile, MCP Administration, create a token for a user yourself (choose the
   user, the companies, the scopes, the lifetime).
5. Revoke any time: revoke the token, disable catalog access or an action, remove a company,
   or delete the user. Saving normal business roles preserves existing MCP assignments.

## Primary admin: one assistant across every tenant

The primary admin is enabled by default (no role to assign) and may connect an AI tool that
manages ALL tenants. It is the only account that can choose **All companies**, which is read live,
so a tenant created later is included at once. Tenant users can never choose it: they reach only
the companies assigned to them, and nothing the primary admin does changes that.

Because this is the widest reach the system has, the primary admin's tokens live at most 30 days
(tenant users: 90), the dialog shows a plain warning when All companies is ticked, and the same
rules apply to every write: a plan shown to a person first, the hourly ceilings, and a log row for
each call. Prefer read-only unless a task needs more, and watch Profile, MCP Administration.
Create the token under Profile, MCP Connections, or for another user under MCP Administration.

## Each user: connect an AI tool

Open **Profile, MCP Connections**. It says whether MCP is enabled for you and gives copy-ready
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

## Public connection guide

The login page links to `/admin/mcp-guide` (or `/mcp-guide` in a root-mounted local build). It explains ChatGPT developer mode, OAuth sign-in, Claude custom connectors and coding-agent setup. The connection URL is always the current site's origin plus `/mcp`; no company or user data appears in the public guide.

MCP access is a premium feature. Users without active access see a purchase/access notice in their profile and on OAuth consent. Tenant administrators coordinate access with the primary administrator; they cannot grant it through catalog edits, custom roles or new MCP system-role assignments. Users can narrow or pause their own grants. Existing MCP role assignments remain compatible.

Provider availability depends on the provider plan and workspace policy. See [OpenAI's current instructions](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) and [Claude's current instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
