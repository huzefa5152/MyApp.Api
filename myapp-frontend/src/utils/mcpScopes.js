// What an MCP token may be granted, in words a person can approve. "read" is always on:
// a token that writes must also be able to read what it writes.
export const SCOPE_INFO = {
  read: { label: "Look things up", help: "Companies, clients, invoices, stock, quotations, challans and reports (sales, receivables, tax sheet, item rates): read only." },
  "templates.read": { label: "Read print designs", help: "Read the selected companies' saved designs and merge-field contracts. Does not change a design." },
  "templates.write": { label: "Edit print designs", help: "Prepare changes to existing print templates in your selected companies. Each change needs approval; changed designs must be read again before saving. Default and stamp assignments stay unchanged." },
  "documents.read": { label: "Read print details", help: "Read document print data, including business details printed on the document, only where your print permissions allow it." },
  "fbr.validate": { label: "Validate bills with FBR", help: "Asks FBR to check a bill using your company's FBR token. Never submits, and no invoice number is issued." },
  "clients.write": { label: "Create and update clients", help: "Each change is shown to you first and saved only after you approve it." },
  "quotes.write": { label: "Create quotations", help: "Sales quotations only, never bills or FBR invoices. Each one is shown to you first." },
  "email.enquiries.write": { label: "Choose email enquiries", help: "Keep, ignore or restore emails in your permitted companies after your approval. Creating a quotation also needs Create quotations access." },
  "challans.write": { label: "Create delivery challans", help: "Delivery notes without prices. Each one is shown to you first." },
  "bills.write": { label: "Create bills", help: "Uses the next number of your invoice sequence and may reduce stock. Each bill is shown to you first and is never submitted to FBR." },
  "suppliers.write": { label: "Create and update suppliers", help: "Each change is shown to you first and saved only after you approve it." },
  "itemtypes.write": { label: "Create and update items", help: "Catalog items for your selected companies. HS codes are checked with FBR when saved. Each change is shown to you first." },
  "taxfiling.write": { label: "Classify bills for FBR", help: "Saves a bill's FBR filing rows (HS code, sale type, unit). The commercial bill is unchanged and nothing is submitted to FBR. Each change is shown to you first." },
  "fbrexclusion.write": { label: "Exclude bills from FBR", help: "Keeps chosen bills, or every bill in a date range, out of FBR validation and submission, or includes them again. Like the Bills screen's toggle, it also takes their goods out of stock and re-posts them to the ledger. Bills already submitted are never touched. Each change is shown to you first." },
};

export const scopeLabel = scope => SCOPE_INFO[scope]?.label || scope;

/** Scopes in a stable display order, read first. */
export const orderedScopes = list => Object.keys(SCOPE_INFO).filter(s => list.includes(s));
