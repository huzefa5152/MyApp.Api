// ════════════════════════════════════════════════════════════════════════════
//  The accounting report registry.
//
//  One declarative list drives: the categorised index page, each report's
//  filter bar, its Excel export, and its drill-down targets. A new report is a
//  backend method plus an entry here — never a new screen.
//
//  Field notes
//    id        stable slug; also the Excel export id the server dispatches on
//    path      route segment under /accounting/reports/company/{id}/
//    filters   which controls the shared filter bar renders, in order
//    exportId  omit to reuse `id`; set when several reports share one export
//    drill     { filter } — the filter a group row sets when clicked through
//
//  Categories mirror the ten the business asked for. Ones whose reports are not
//  built yet carry `status: "planned"` so the index can show the roadmap
//  honestly instead of pretending a link exists.
// ════════════════════════════════════════════════════════════════════════════

/** Every filter control the bar knows how to render. */
export const FILTERS = {
  period: "period",
  division: "division",
  account: "account",
  accountGroup: "accountGroup",
  paymentAccount: "paymentAccount",
  payeeType: "payeeType",
  payee: "payee",
  client: "client",
  supplier: "supplier",
  tax: "tax",
  status: "status",
  search: "search",
};

/** Date presets, matching Helpers/ReportPeriod.cs exactly. */
export const PERIOD_OPTIONS = [
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "today", label: "Today" },
  { value: "thisWeek", label: "This Week" },
  { value: "thisQuarter", label: "This Quarter" },
  { value: "thisYear", label: "This Year" },
  { value: "lastYear", label: "Last Year" },
  { value: "custom", label: "Custom range…" },
  { value: "allPeriods", label: "All Periods" },
];

const EXPENSE_FILTERS = [
  FILTERS.period,
  FILTERS.division,
  FILTERS.account,
  FILTERS.accountGroup,
  FILTERS.payeeType,
  FILTERS.payee,
  FILTERS.paymentAccount,
  FILTERS.tax,
  FILTERS.status,
  FILTERS.search,
];

const CUSTOMER_FILTERS = [
  FILTERS.period,
  FILTERS.division,
  FILTERS.client,
  FILTERS.status,
  FILTERS.search,
];

const SUPPLIER_FILTERS = [
  FILTERS.period,
  FILTERS.division,
  FILTERS.supplier,
  FILTERS.status,
  FILTERS.search,
];

const MONEY_FILTERS = [
  FILTERS.period,
  FILTERS.division,
  FILTERS.paymentAccount,
  FILTERS.payeeType,
  FILTERS.payee,
  FILTERS.tax,
  FILTERS.status,
  FILTERS.search,
];

export const REPORT_CATEGORIES = [
  {
    id: "expenses",
    title: "Expenses",
    blurb: "Where the company's money went — by account, payee, category or date.",
    reports: [
      {
        id: "expenses",
        path: "expenses",
        title: "Company Expense Report",
        blurb: "Every expense in the period, with by-account and by-payee breakdowns.",
        filters: EXPENSE_FILTERS,
        featured: true,
        // Its by-Account / by-Payee blocks drill into the flat detail list. The
        // server names the filter per block (accountId / payeeId), so one target
        // serves both.
        detailTarget: "expenses-detail",
      },
      {
        id: "expenses-detail",
        path: "expenses/detail",
        title: "Expense Detail",
        blurb: "The same rows as a flat, sortable list with no summary blocks.",
        filters: EXPENSE_FILTERS,
      },
      {
        id: "expenses-summary",
        path: "expenses/summary",
        title: "Expense Summary",
        blurb: "Totals per expense account for the period.",
        filters: EXPENSE_FILTERS,
        query: { groupBy: "account" },
        exportId: "expenses-summary",
        detailTarget: "expenses-detail",
      },
      {
        id: "expenses-by-account",
        path: "expenses/summary",
        title: "Expenses by Account",
        blurb: "Which accounts absorbed the spend. Click a row for its detail.",
        filters: EXPENSE_FILTERS,
        query: { groupBy: "account" },
        exportId: "expenses-summary",
        drill: { filter: "accountId", to: "expenses-detail" },
      },
      {
        id: "expenses-by-payee",
        path: "expenses/summary",
        title: "Expenses by Payee",
        blurb: "Who the company paid, largest first.",
        filters: EXPENSE_FILTERS,
        query: { groupBy: "payee" },
        exportId: "expenses-summary",
        drill: { filter: "payeeId", to: "expenses-detail" },
      },
      {
        id: "expenses-by-category",
        path: "expenses/summary",
        title: "Expenses by Category",
        // Named honestly: there is no separate category concept in this product,
        // the grouping is the account's Chart-of-Accounts group.
        blurb: "Grouped by Chart-of-Accounts group — rent, utilities, travel and so on.",
        filters: EXPENSE_FILTERS,
        query: { groupBy: "group" },
        exportId: "expenses-summary",
        drill: { filter: "accountGroupId", to: "expenses-detail" },
      },
      {
        id: "expenses-by-date",
        path: "expenses/summary",
        title: "Expenses by Date",
        blurb: "Daily spend across the period, in date order.",
        filters: EXPENSE_FILTERS,
        query: { groupBy: "date" },
        exportId: "expenses-summary",
      },
      {
        id: "expenses-monthly",
        path: "expenses/summary",
        title: "Monthly Expenses",
        blurb: "Month-by-month spend — the trend, not the transactions.",
        filters: EXPENSE_FILTERS,
        query: { groupBy: "month" },
        exportId: "expenses-summary",
      },
      {
        id: "expenses-by-payment-account",
        path: "expenses/summary",
        title: "Expenses by Payment Account",
        blurb: "Which bank or cash account the spend left from.",
        filters: EXPENSE_FILTERS,
        query: { groupBy: "paymentAccount" },
        exportId: "expenses-summary",
        drill: { filter: "paymentAccountId", to: "expenses-detail" },
      },
      {
        id: "expenses-by-tax",
        path: "expenses/summary",
        title: "Expenses by Tax",
        blurb: "Spend split by the tax rate recorded on it.",
        filters: EXPENSE_FILTERS,
        query: { groupBy: "tax" },
        exportId: "expenses-summary",
      },
    ],
  },
  {
    id: "cash-bank",
    title: "Cash & Bank",
    blurb: "What you hold, what moved it, and what has not cleared yet.",
    reports: [
      {
        id: "cash-bank-summary",
        path: "cash-bank-summary",
        title: "Cash & Bank Summary",
        blurb: "Every bank and cash account: opening, movement, closing, uncleared cheques.",
        filters: [FILTERS.period, FILTERS.division],
        featured: true,
        drill: { filter: "accountId", to: "bank-book" },
      },
      {
        id: "cash-book",
        path: "cash-book",
        title: "Cash Book",
        blurb: "Cash receipts and payments with a running balance.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.account],
        accountKind: "cash",
      },
      {
        id: "bank-book",
        path: "bank-book",
        title: "Bank Book",
        blurb: "Bank receipts and payments with a running balance.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.account],
        accountKind: "bank",
      },
      {
        id: "receipts-register",
        path: "receipts-register",
        title: "Receipt Register",
        blurb: "All money in, and what each receipt was applied to.",
        filters: MONEY_FILTERS,
      },
      {
        id: "payments-register",
        path: "payments-register",
        title: "Payment Register",
        blurb: "All money out, and what each payment settled.",
        filters: MONEY_FILTERS,
        featured: true,
      },
      {
        id: "receipts-by-account",
        path: "receipts-by-account",
        title: "Receipts by Account",
        blurb: "Money in, grouped by what it was applied to.",
        filters: MONEY_FILTERS,
      },
      {
        id: "payments-by-account",
        path: "payments-by-account",
        title: "Payments by Account",
        blurb: "Money out, grouped by what it was applied to.",
        filters: MONEY_FILTERS,
      },
      {
        id: "cheques-in-hand",
        path: "cheques-in-hand",
        title: "Cheques in Hand",
        blurb: "Cheques received and not yet cleared, soonest due first.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.paymentAccount, FILTERS.payee, FILTERS.status],
      },
      {
        id: "cheques-issued",
        path: "cheques-issued",
        title: "Cheques Issued",
        blurb: "Cheques written and not yet cleared — money about to leave.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.paymentAccount, FILTERS.payee, FILTERS.status],
      },
      {
        id: "unallocated",
        path: "unallocated",
        title: "Unallocated Payments",
        blurb: "Advances with no invoice or bill against them yet, oldest first.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.payeeType, FILTERS.payee],
      },
    ],
  },
  {
    id: "financial-statements",
    title: "Financial Statements",
    blurb: "The statutory view of the books.",
    reports: [
      {
        id: "trial-balance",
        title: "Trial Balance",
        blurb: "Opening, period debit and credit, and closing for every account.",
        legacy: "trial-balance",
        featured: true,
      },
      {
        id: "balance-sheet",
        title: "Balance Sheet",
        blurb: "Assets, liabilities and equity as at a date, with comparatives.",
        status: "planned",
      },
      {
        id: "profit-loss",
        title: "Profit & Loss",
        blurb: "Income and expenses for a period, with comparatives.",
        status: "planned",
      },
      {
        id: "general-ledger",
        title: "General Ledger",
        blurb: "Every posting across all accounts in one stream.",
        status: "planned",
      },
      {
        id: "account-balance-summary",
        title: "Account Balance Summary",
        blurb: "Opening, movement and closing per account, filterable by group.",
        status: "planned",
      },
    ],
  },
  {
    id: "customers",
    title: "Customers",
    blurb: "Who owes you, how much, and how the balance arose.",
    reports: [
      {
        id: "aged-receivables",
        path: "receivables-aging",
        title: "Accounts Receivable Aging",
        blurb: "Outstanding customer balances bucketed by age. Click a customer for the invoices behind it.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.client, FILTERS.status, FILTERS.search],
        featured: true,
        drill: { filter: "clientId", to: "customer-outstanding" },
      },
      {
        id: "customer-ledger",
        path: "customer-ledger",
        title: "Customer Ledger",
        blurb: "Every transaction on a customer's account, any period including all-time.",
        filters: CUSTOMER_FILTERS,
        featured: true,
      },
      {
        id: "customer-statement",
        path: "customer-statement",
        title: "Customer Statement",
        blurb: "The same figures laid out to send to the customer, with an age breakdown.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.client],
        statement: true,
      },
      {
        id: "customer-balances",
        path: "customer-balances",
        title: "Customer Balance Summary",
        blurb: "One line per customer: opening, invoiced, received, owed.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.search],
        drill: { filter: "clientId", to: "customer-ledger" },
      },
      {
        id: "customer-sales",
        path: "customer-sales",
        title: "Customer Sales",
        blurb: "What each customer bought, by item and item type.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.client, FILTERS.search],
      },
      {
        id: "customer-outstanding",
        path: "customer-outstanding",
        title: "Outstanding Invoices",
        blurb: "Unpaid sales invoices, oldest debt first, with an age bucket each.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.client, FILTERS.search],
        drill: { filter: "clientId", to: "customer-ledger" },
      },
      {
        // Not a new report: the Receipt Register already answers this, scoped to
        // one customer. A duplicate implementation would be a second place for
        // the same figures to drift.
        id: "customer-receipts",
        path: "receipts-register",
        title: "Customer Receipts",
        blurb: "Every receipt taken from a customer — the Receipt Register, scoped to them.",
        filters: MONEY_FILTERS,
        exportId: "receipts-register",
      },
    ],
  },
  {
    id: "suppliers",
    title: "Suppliers",
    blurb: "What you owe, to whom, and for how long.",
    reports: [
      {
        id: "aged-payables",
        path: "payables-aging",
        title: "Accounts Payable Aging",
        blurb: "Outstanding supplier balances bucketed by age. Click a supplier for the bills behind it.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.supplier, FILTERS.status, FILTERS.search],
        featured: true,
        drill: { filter: "supplierId", to: "supplier-outstanding" },
      },
      {
        id: "supplier-ledger",
        path: "supplier-ledger",
        title: "Supplier Ledger",
        blurb: "Every transaction on a supplier's account, any period including all-time.",
        filters: SUPPLIER_FILTERS,
        featured: true,
      },
      {
        id: "supplier-statement",
        path: "supplier-statement",
        title: "Supplier Statement",
        blurb: "A reconcilable statement of one supplier's account, with an age breakdown.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.supplier],
        statement: true,
      },
      {
        id: "supplier-balances",
        path: "supplier-balances",
        title: "Supplier Balance Summary",
        blurb: "One line per supplier: opening, billed, paid, owed.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.search],
        drill: { filter: "supplierId", to: "supplier-ledger" },
      },
      {
        id: "supplier-purchases",
        path: "supplier-purchases",
        title: "Supplier Purchases",
        blurb: "What was bought from each supplier, by item and item type.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.supplier, FILTERS.search],
      },
      {
        id: "supplier-outstanding",
        path: "supplier-outstanding",
        title: "Outstanding Bills",
        blurb: "Unpaid purchase bills, oldest debt first, with an age bucket each.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.supplier, FILTERS.search],
        drill: { filter: "supplierId", to: "supplier-ledger" },
      },
      {
        id: "supplier-payments",
        path: "payments-register",
        title: "Supplier Payments",
        blurb: "Every payment made to a supplier — the Payment Register, scoped to them.",
        filters: MONEY_FILTERS,
        exportId: "payments-register",
      },
      {
        id: "supplier-sales",
        title: "Supplier Sales",
        blurb: "Sales made to a supplier.",
        status: "blocked",
        // Stated on the card rather than quietly omitted, because it was asked
        // for explicitly.
        blockedReason:
          "Not applicable in this system: a sales invoice is always raised to a Client, "
          + "and suppliers are purchase-side only. If you ever sell to a supplier, add them "
          + "as a customer too and they will appear in the customer reports.",
      },
    ],
  },
  {
    id: "sales",
    title: "Sales",
    blurb: "What sold, to whom, and whether it has been paid.",
    reports: [
      { id: "sales-invoice-register", title: "Sales Invoice Register", blurb: "Every invoice with tax, paid and outstanding.", status: "planned" },
      {
        id: "sales-by-customer",
        path: "customer-sales",
        title: "Sales by Customer",
        blurb: "Revenue per customer, with the item detail behind it.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.client, FILTERS.search],
        exportId: "customer-sales",
      },
      { id: "sales-by-item", title: "Sales by Item", blurb: "Revenue and quantity per item.", status: "planned" },
      { id: "sales-by-item-type", title: "Sales by Item Type", blurb: "Revenue rolled up by item type.", status: "planned" },
      { id: "sales-payment-status", title: "Sales Payment Status", blurb: "Paid, part-paid and unpaid invoices at a glance.", status: "planned" },
    ],
  },
  {
    id: "purchases",
    title: "Purchases",
    blurb: "What was bought, from whom, and what is still owed.",
    reports: [
      { id: "purchase-bill-register", title: "Purchase Bill Register", blurb: "Every bill with tax, paid and outstanding.", status: "planned" },
      {
        id: "purchases-by-supplier",
        path: "supplier-purchases",
        title: "Purchases by Supplier",
        blurb: "Spend per supplier, with the item detail behind it.",
        filters: [FILTERS.period, FILTERS.division, FILTERS.supplier, FILTERS.search],
        exportId: "supplier-purchases",
      },
      { id: "purchases-by-item", title: "Purchases by Item", blurb: "Quantity and value per item purchased.", status: "planned" },
      { id: "purchase-payment-status", title: "Purchase Payment Status", blurb: "Paid, part-paid and unpaid bills.", status: "planned" },
    ],
  },
  {
    id: "taxes",
    title: "Taxes",
    blurb: "Output tax collected, input tax paid, and the net position.",
    reports: [
      { id: "tax-summary", title: "Tax Summary", blurb: "Output vs input tax and the net payable.", status: "planned" },
      { id: "output-tax", title: "Sales / Output Tax", blurb: "Tax charged to customers, by invoice.", status: "planned" },
      { id: "input-tax", title: "Purchase / Input Tax", blurb: "Tax paid to suppliers and on expenses.", status: "planned" },
      { id: "tax-transactions", title: "Tax Transaction Detail", blurb: "Every taxed transaction behind the totals.", status: "planned" },
    ],
  },
  {
    id: "control",
    title: "Accounting Control",
    blurb: "Checks that the books hang together.",
    reports: [
      { id: "journal-register", title: "Journal Register", blurb: "Every journal entry, system-posted and manual.", status: "planned" },
      { id: "posting-exceptions", title: "Posting Exceptions", blurb: "Suspense balances and documents with no journal entry.", status: "planned" },
    ],
  },
  {
    id: "management",
    title: "Management",
    blurb: "The summary view for decisions.",
    reports: [
      { id: "revenue-summary", title: "Revenue Summary", blurb: "Income by account and month.", status: "planned" },
      { id: "monthly-sales", title: "Monthly Sales", blurb: "Sales, tax and net per month.", status: "planned" },
      { id: "monthly-purchases", title: "Monthly Purchases", blurb: "Purchases, tax and net per month.", status: "planned" },
      { id: "cash-flow", title: "Cash Flow Summary", blurb: "Money in, money out and the net movement.", status: "planned" },
      {
        id: "gross-profit",
        title: "Gross Profit",
        blurb: "Revenue less cost of sales.",
        status: "blocked",
        // Stated on the card so nobody files this as a missing feature: the
        // ledger has no cost of sales to report against yet.
        blockedReason:
          "Needs cost of sales. Sales invoices post revenue but nothing relieves inventory, "
          + "so there is no cost to compare against yet.",
      },
      {
        id: "customer-profitability",
        title: "Customer Profitability",
        blurb: "Margin per customer.",
        status: "blocked",
        blockedReason:
          "Needs cost of sales — same dependency as Gross Profit.",
      },
    ],
  },
];

/** Flat lookup by report id. */
export const REPORTS_BY_ID = Object.fromEntries(
  REPORT_CATEGORIES.flatMap((c) =>
    c.reports.map((r) => [r.id, { ...r, categoryId: c.id, categoryTitle: c.title }])
  )
);

/** Reports that are actually built (have a server path or a legacy tab). */
export const isAvailable = (report) =>
  !!report && !report.status && (!!report.path || !!report.legacy);

/** The handful surfaced as quick links at the top of the index. */
export const FEATURED_REPORT_IDS = REPORT_CATEGORIES
  .flatMap((c) => c.reports)
  .filter((r) => r.featured)
  .map((r) => r.id);
