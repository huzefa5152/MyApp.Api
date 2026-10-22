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
  "quotes.write": { label: "Create and edit quotations", help: "Sales quotations and their status, never bills. Each change is shown to you first." },
  "orders.write": { label: "Create and edit sales orders", help: "Sales orders and their status. Each change is shown to you first." },
  "challans.write": { label: "Create and edit delivery challans", help: "Delivery notes without prices. Each change is shown to you first." },
  "bills.write": { label: "Create and edit bills and notes", help: "Bills, credit and debit notes and supplementary bills. May use the next number and change stock. Each change is shown to you first. Filing with FBR is a separate permission." },
  "purchases.write": { label: "Record purchases", help: "Purchase bills and goods received. May add stock. Each one is shown to you first." },
  "receipts.write": { label: "Record customer receipts", help: "Money received from customers. Each receipt is shown to you first." },
  "payments.write": { label: "Record supplier payments", help: "Money paid to suppliers. Each payment is shown to you first." },
  "gds.write": { label: "Update import costing", help: "GD costing, charges, line corrections and claim months. Each change is shown to you first." },
  "lcs.write": { label: "Update letters of credit", help: "Add and edit letters of credit. Each change is shown to you first." },
  "stock.write": { label: "Update stock", help: "Opening stock, stock adjustments and the late-GD value fix. Each change is shown to you first." },
  "journal.write": { label: "Create and edit journal entries", help: "Manual journal entries in the accounts. Each entry is shown to you first." },
  "delete.write": { label: "Delete and cancel documents", help: "Delete records, cancel challans and void bills, where the ERP allows it. Cannot be undone. Each one is shown to you first." },
  "fbr.submit": { label: "File bills with FBR", help: "Submits bills to FBR with your company's token. FBR issues a legal invoice number that cannot be undone. Each bill is shown to you first." },
};

export const scopeLabel = scope => SCOPE_INFO[scope]?.label || scope;

/** Scopes in a stable display order, read first. Unknown scopes are left out. */
export const orderedScopes = list => Object.keys(SCOPE_INFO).filter(s => list.includes(s));
