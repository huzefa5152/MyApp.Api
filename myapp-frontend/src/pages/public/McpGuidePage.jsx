import { Link } from "react-router-dom";

export default function McpGuidePage() {
  const url = `${window.location.origin}/mcp`;
  return <main style={{maxWidth:880,margin:"0 auto",padding:"32px 20px",lineHeight:1.7,overflowWrap:"anywhere"}}>
    <Link to="/login" style={{display:"inline-block",minHeight:44}}>Back to sign in</Link>
    <h1>Connect your AI assistant with MCP</h1>
    <p>Connect ChatGPT, Claude or a compatible coding agent to your ERP account. MCP is a premium feature: contact your administrator to purchase access. The primary administrator enables your account before you can connect.</p>
    <h2>Your connection address</h2>
    <p>Use the address of your deployed ERP site. This address adapts to the site you are visiting:</p>
    <pre style={{whiteSpace:"pre-wrap",wordBreak:"break-all",padding:16,background:"#eef3f8",borderRadius:8}}>{url}</pre>
    <h2>ChatGPT: sign in with OAuth</h2>
    <ol>
      <li>Open ChatGPT on the web. In Settings, open Apps (sometimes called Connectors), then Advanced settings and enable Developer mode. Workspace administrators may need to enable custom apps first. Availability depends on your ChatGPT plan and workspace settings.</li>
      <li>Create a custom app, give it a name such as ERP, enter the connection address above and choose OAuth authentication. This server supports dynamic client registration; use it when the client offers that option.</li>
      <li>Connect the app. On the ERP sign-in page, use your own ERP username and password. Review the requesting app, select your assigned companies and the allowed actions, then choose Approve and connect.</li>
      <li>Return to ChatGPT, enable the app in your conversation and ask: “List the companies I can access.” Then choose a company before requesting a report or operation.</li>
    </ol>
    <p><a href="https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt" target="_blank" rel="noreferrer">Current ChatGPT developer-mode instructions</a></p>
    <h2>Claude: custom connector</h2>
    <p>Open Settings → Connectors, add a custom connector using the address above, then sign in through ERP and approve your companies and actions. Enable the connector in your conversation. Your Claude plan or workspace may control whether custom connectors are available.</p>
    <p><a href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp" target="_blank" rel="noreferrer">Current Claude connector instructions</a></p>
    <h2>Codex and other coding agents</h2>
    <p>Use your agent’s remote HTTP MCP configuration with the address above and choose OAuth. Sign in with your ERP account and review the requesting app, companies and actions before approving the connection. Your client must support remote MCP with OAuth.</p>
    <h2>What the assistant can access</h2>
    <p>Access is the intersection of your assigned companies, your ERP role permissions, the primary administrator’s MCP grants, your selected tools and your connection’s approved companies and scopes. Connecting never gives you another company or an extra role. Changes still require the existing prepare, review and approval flow; MCP access alone does not enable every operation.</p>
    <p>In this edition, MCP company operations are unavailable for accounts restricted to specific divisions. Use the application for those operations; an MCP connection cannot bypass division restrictions.</p>
    <h2>Manage or disconnect</h2>
    <p>In Profile → MCP Connections, review activity and revoke a connection. Only the seed administrator can configure MCP catalog access for your account. Revocation and changes to your roles, companies or MCP grants are checked on subsequent requests.</p>
    <h2>If access is unavailable</h2>
    <p>“Purchase this premium feature” means your account has no active MCP access. Your administrator coordinates the purchase and the primary administrator assigns access. If no companies appear, ask for a company assignment. If an action is missing, your role, MCP tool selection or connection scope may not allow it. Reconnect after your permissions change if the AI app retains an older tool list.</p>
  </main>;
}
