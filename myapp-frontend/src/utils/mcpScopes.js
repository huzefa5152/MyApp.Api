// What an MCP token may be granted, in words a person can approve. "read" is always on:
// a token that writes must also be able to read what it writes.
export const SCOPE_INFO = {
  read: { label: "Look things up", help: "Companies, clients, invoices, stock, quotations, challans and reports (sales, receivables, tax sheet, item rates): read only." },
  "templates.read": { label: "Read print designs", help: "Read the selected companies' saved designs and merge-field contracts. Does not change a design." },
  "documents.read": { label: "Read print details", help: "Read document print data, including business details printed on the document, only where your print permissions allow it." },
  "clients.write": { label: "Create and update clients", help: "Each change is shown to you first and saved only after you approve it." },
  "quotes.write": { label: "Create quotations", help: "Sales quotations only, never bills or FBR invoices. Each one is shown to you first." },
  "challans.write": { label: "Create delivery challans", help: "Delivery notes without prices. Each one is shown to you first." },
  "bills.write": { label: "Create bills", help: "Uses the next number of your invoice sequence and may reduce stock. Each bill is shown to you first and is never submitted to FBR." },
};

export const scopeLabel = scope => SCOPE_INFO[scope]?.label || scope;

/** Scopes in a stable display order, read first. */
export const orderedScopes = list => Object.keys(SCOPE_INFO).filter(s => list.includes(s));
