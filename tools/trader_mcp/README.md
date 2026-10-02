# Trader MCP

A local **stdio** MCP server for Claude Desktop, Claude Code and Codex. It calls
the existing Trader REST API as the signed-in user. It does not connect to SQL,
change the web application, or publish a remote `/mcp` endpoint. No ERP deploy
or migration is needed. Claude's browser-only web app cannot launch this local
server; use Claude Desktop or Claude Code.

## Tools and boundaries

`list_companies`, `search_clients`, `search_invoices`, `get_invoice`, `get_stock`,
`search_quotes`, `preview_quote`. `create_quote` is registered only when explicitly
enabled in the local profile. It creates a sales quotation, not a bill or FBR invoice.

All calls use the caller's token and existing API permission/tenant checks.
Company access is checked again on each invocation. An optional local company
allowlist further restricts the connection, including seed admin. An empty list
allows no companies; omit the property to use the user's assigned companies for
reads. Writes require a non-empty allowlist. API-revoked/expired sessions fail closed.
There is no auto-login or refresh that would silently undo logout.

Returned names/descriptions are untrusted data, not instructions. Company tokens,
addresses and tax identifiers are omitted. Invoice payment fields retain the
API's permission filtering. Query output is bounded; follow pages for complete
results. Source data may still be sent to the LLM provider when using these tools;
connect only the account and companies you intend that provider to process.

Quotation preview uses .NET's midpoint-to-even rounding and exact decimal strings.
It does not allocate a number or save anything. Creation consumes a ten-minute,
single-use preview and uses the ERP's Auto numbering, cross-company validation
and calculations. No POST retries. An interrupted response can have an unknown
outcome: inspect `search_quotes` before preparing another creation. This is
at-most-one attempt per preview, not a database-level exactly-once guarantee.

**Approval for writes belongs to the MCP host/operator.** A preview ID is not proof
of human consent. Keep the host's confirmation prompts on for `create_quote`.
Enabling the tool and granting an account create permission lets an agent act with
that authority; do not enable unattended writes unless that is intentional.
Each client process has its own previews. Restarting it discards unsaved previews.

## Install and sign in (Windows)

Requires Python 3.10+. Run from the repository root:

```powershell
python -m venv "$env:LOCALAPPDATA/TraderMcp/venv"
& "$env:LOCALAPPDATA/TraderMcp/venv/Scripts/python.exe" -m pip install -r tools/trader_mcp/requirements.txt
Copy-Item tools/trader_mcp/profile.example.json "$env:LOCALAPPDATA/TraderMcp/profile.json"
```

Edit that **outside-the-repository** profile: set `apiBaseUrl` to your Trader
website origin (no `/admin` suffix). Set `allowedCompanyIds` to the intended IDs.
For read-only access to the account's whole assigned set, omit `allowedCompanyIds`.
Leave `enableQuoteCreation` false initially. Use a restricted operator account.

```powershell
& "$env:LOCALAPPDATA/TraderMcp/venv/Scripts/python.exe" tools/trader_mcp/login.py --config "$env:LOCALAPPDATA/TraderMcp/profile.json"
```

The helper prompts locally for username/password. It saves only a Windows DPAPI
encrypted session token, usable by the same Windows user. Never paste a password
or session token into a chat. Keep the profile private even though its token is
encrypted. When the token expires or is revoked, run this helper again, then
restart the MCP connection. Do not commit profiles or credentials.

For local development set `apiBaseUrl` to `http://127.0.0.1:<local-port>` and use
disposable local accounts. Remote origins must use HTTPS. TLS verification stays on.

## Codex

Add this block to your user-level `~/.codex/config.toml`, replacing the three
absolute paths. No credential belongs in this config:

```toml
[mcp_servers.trader]
command = 'C:\Users\YOUR_USER\AppData\Local\TraderMcp\venv\Scripts\python.exe'
args = ['D:\YOUR_REPOSITORY\tools\trader_mcp\server.py', '--config', 'C:\Users\YOUR_USER\AppData\Local\TraderMcp\profile.json']
startup_timeout_sec = 30
tool_timeout_sec = 60
```

Alternatively `codex mcp add trader -- <python-path> <server-path> --config <profile-path>`.
Restart Codex's MCP connection/app, check `codex mcp list`, then ask it to call
`list_companies`. The desktop app and CLI use the shared MCP configuration.
See [official Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Claude Code

Use absolute paths in this PowerShell command:

```powershell
claude mcp add --transport stdio --scope user trader -- "C:/Users/YOUR_USER/AppData/Local/TraderMcp/venv/Scripts/python.exe" "D:/YOUR_REPOSITORY/tools/trader_mcp/server.py" --config "C:/Users/YOUR_USER/AppData/Local/TraderMcp/profile.json"
claude mcp get trader
```

Start/restart Claude Code, run `/mcp`, and check Trader is connected.
See [official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## Claude Desktop

Open Settings > Developer > Edit Config and merge this entry into the existing
`mcpServers` object. Do not replace other servers:

```json
{
  "mcpServers": {
    "trader": {
      "command": "C:/Users/YOUR_USER/AppData/Local/TraderMcp/venv/Scripts/python.exe",
      "args": ["D:/YOUR_REPOSITORY/tools/trader_mcp/server.py", "--config", "C:/Users/YOUR_USER/AppData/Local/TraderMcp/profile.json"]
    }
  }
}
```

Restart Claude Desktop and verify the Trader tools are available. See the
[official local MCP connection guide](https://modelcontextprotocol.io/quickstart/user).

## Enable quotation creation

After testing reads, set `enableQuoteCreation` to true and set a non-empty
`allowedCompanyIds` list in your private profile. The user must also have
`salesquotes.manage.create` in Trader. Restart the connection. Ask the model to
preview a quotation and show it for approval before calling `create_quote`.
Do not whitelist that write tool for automatic approval unless intended.

Examples:

- "List the companies this connection can access."
- "Find this company's invoices for September, with FBR status. Fetch every page."
- "Find this client's balance using the server's balanceDue figures."
- "Show this company's current stock for this item."
- "Preview a quotation for this client with these quantities and prices; don't save yet."

No tools expose invoice edits, receipts, FBR submission, deletion, access management,
generic SQL or arbitrary HTTP requests. A hosted OAuth MCP endpoint and unattended
scheduled actions are separate work, not part of this local adapter.

## Verify locally

```powershell
python tools/trader_mcp/test_server.py
```

Uses mock HTTP responses and exercises the actual MCP stdio handshake. Live local
verification also passed with disposable test accounts, companies and quotations,
including access revocation and Auto numbering; evidence is kept in ignored local
audit logs. Never point a write test at production. These checks do not establish
Claude/Codex UI connectivity on your account until the client config is installed.
