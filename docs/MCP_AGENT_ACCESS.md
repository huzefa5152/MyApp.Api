# Hosted MCP — connecting AI agents to Trader

The Trader site exposes a **read-only** Model Context Protocol endpoint at
`https://<your-site>/mcp` (Streamable HTTP, stateless). An agent connected to it
acts as ONE signed-in user and can read only what that user can already open in
the web app. Replace `<your-site>` with the site's origin; never commit the real
host, a token or a password.

## What an agent can do

`list_companies`, `search_clients`, `search_invoices`, `get_invoice`,
`get_stock`, `search_quotes`. No write, FBR-submission, delete, permission, SQL
or arbitrary-URL tool exists. Output is data, never instructions.

## How data stays inside the right company and tenant

Every call re-checks, as the signed-in user: (1) the `mcp.access.use` key,
(2) the same permission key as the matching screen, (3) access to the requested
company through `UserCompany` (never cached; a foreign and a non-existent id
answer identically), (4) for document ids, the company stored on the document.
Removing a company, a role, or logging out takes effect on the very next call.
`scripts/test_mcp_isolation.py` proves all of this (90 checks).

## Seed admin: switching MCP on for a tenant

MCP is **off by default**. Neither edition carries `mcp.access.use`; it lives in
the built-in **MCP Access** system role, which you assign ALONGSIDE an edition.

1. **Create the tenant administrator** (Users > New): the tenant's owner. Roles:
   `Tenant Administrator` + an edition (`Sales Edition` or `Complete Edition`) +
   **`MCP Access`**. Under Companies, grant only that tenant's companies.
   Leave out `MCP Access` and that tenant can never use MCP, and cannot create a
   role or assign one that carries it ("you hold only what you grant").
2. **The tenant administrator creates staff** (Users > New). For each person:
   edition role + `MCP Access`, and only the companies that person should reach.
   For a narrower agent, build a private role from the keys needed (for example
   `mcp.access.use`, `invoices.list.view`, `clients.manage.view`) instead of a
   whole edition.
3. **Use a dedicated agent account** per person or purpose. Never connect the
   seed admin: it sees every company in every tenant by design.
4. Revoke any time: remove `MCP Access` from the user, remove a company, or
   delete the user. The next agent call is refused.

## Each user: connect an agent

Get a token by signing in (it is the same bearer token the web app uses; it
expires and then you sign in again; logging out revokes it). Keep it in an
environment variable, never in a chat or a file in a repository:

```bash
curl -s -X POST https://<your-site>/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"<agent-user>","password":"<password>"}'
# copy the "token" value into TRADER_MCP_TOKEN
```

**Claude Code**

```bash
claude mcp add --transport http --scope user trader https://<your-site>/mcp \
  --header "Authorization: Bearer $TRADER_MCP_TOKEN"
```

**Codex** (`~/.codex/config.toml`; the token stays in the environment)

```toml
[mcp_servers.trader]
url = "https://<your-site>/mcp"
bearer_token_env_var = "TRADER_MCP_TOKEN"
```

**Claude Desktop** (Settings > Developer > Edit Config; needs Node.js, uses the
`mcp-remote` bridge because the connectors screen cannot send a static header)

```json
{ "mcpServers": { "trader": { "command": "npx",
  "args": ["-y", "mcp-remote", "https://<your-site>/mcp", "--header", "Authorization:${AUTH}"],
  "env": { "AUTH": "Bearer <paste token here>" } } } }
```

**claude.ai in the browser and ChatGPT** connect to remote servers through
OAuth. This endpoint uses bearer tokens, so those two cannot connect yet; an
OAuth front door is separate work. Until then use Claude Code, Codex or Claude
Desktop.

Check it works: ask the agent to call `list_companies`. Only the user's own
companies must appear.
