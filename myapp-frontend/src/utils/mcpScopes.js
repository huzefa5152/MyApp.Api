// What an MCP token may be granted, in words a person can approve. "read" is always on:
// a token that writes must also be able to read what it writes. Every change an AI
// prepares is shown to a person first and saved only after they approve it.
export const SCOPE_INFO = {
  read: { label: "Look things up", help: "Read everything you can already see: companies, customers, suppliers, items, stock, sales, purchases, import costing, accounts and reports. Changes nothing." },
  "templates.read": { label: "Read print designs", help: "Read the selected companies' saved print designs. Does not change a design." },
  "documents.read": { label: "Read print details", help: "Read what a document prints, including business details on it, only where your print permissions allow it." },
  "fbr.validate": { label: "Check bills with FBR", help: "Asks FBR to check a bill using your company's FBR token. Never submits it, and no FBR invoice number is issued." },
  "clients.write": { label: "Add and edit customers", help: "Each change is shown to you first and saved only after you approve it." },
  "suppliers.write": { label: "Add and edit suppliers", help: "Each change is shown to you first and saved only after you approve it." },
  "itemtypes.write": { label: "Add and edit items", help: "Items in your selected companies. HS codes are checked when saved. Each change is shown to you first." },
  "quotes.write": { label: "Create quotations", help: "Sales quotations only, never bills. Each one is shown to you first." },
  "orders.write": { label: "Create sales orders", help: "Sales orders only. Each one is shown to you first." },
  "challans.write": { label: "Create delivery challans", help: "Delivery notes without prices. Each one is shown to you first." },
  "bills.write": { label: "Create bills", help: "Uses the next bill number and may reduce stock. Each bill is shown to you first and is never submitted to FBR." },
  "purchases.write": { label: "Record purchases", help: "Purchase bills and goods received. May add stock. Each one is shown to you first." },
  "receipts.write": { label: "Record customer receipts", help: "Money received from customers. Each receipt is shown to you first." },
  "payments.write": { label: "Record supplier payments", help: "Money paid to suppliers. Each payment is shown to you first." },
  "gds.write": { label: "Update import costing", help: "GD costing, charges, line corrections and claim months. Each change is shown to you first." },
  "lcs.write": { label: "Update letters of credit", help: "Add and edit letters of credit. Each change is shown to you first." },
  "stock.write": { label: "Enter opening stock", help: "Opening stock balances. Each change is shown to you first." },
  "journal.write": { label: "Create journal entries", help: "Manual journal entries in the accounts. Each entry is shown to you first." },
};

export const scopeLabel = scope => SCOPE_INFO[scope]?.label || scope;

/** Scopes in a stable display order, read first. Unknown scopes are left out. */
export const orderedScopes = list => Object.keys(SCOPE_INFO).filter(s => list.includes(s));
