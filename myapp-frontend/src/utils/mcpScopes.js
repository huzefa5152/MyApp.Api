// What an MCP token may be granted, in words a person can approve. "read" is always on:
// a token that writes must also be able to read what it writes.
export const SCOPE_INFO = {
  read: { label: "Look things up", help: "Companies, clients, invoices, stock and quotations: read only." },
  "clients.write": { label: "Create and update clients", help: "Each change is shown to you first and saved only after you approve it." },
  "quotes.write": { label: "Create quotations", help: "Sales quotations only, never bills or FBR invoices. Each one is shown to you first." },
};

export const scopeLabel = scope => SCOPE_INFO[scope]?.label || scope;

/** Scopes in a stable display order, read first. */
export const orderedScopes = list => Object.keys(SCOPE_INFO).filter(s => list.includes(s));
