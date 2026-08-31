/**
 * The in-app Accounting user guide, as data.
 *
 * Written for a business owner, not an accountant: every task says which screen
 * to open, which button to click and which fields to fill, then shows what the
 * system records behind the scenes. Every navigation path, screen name, button
 * label and field name here was taken from the actual application — if you
 * rename a screen or a button, update the matching step.
 *
 * Block types the renderer understands:
 *   { p: "…" }                     a paragraph (supports **bold**)
 *   { steps: ["…", …] }            a numbered procedure
 *   { bullets: ["…", …] }          a bullet list
 *   { path: "Accounting → …" }     a navigation breadcrumb callout
 *   { note: "…" }                  an aside worth noticing
 *   { warn: "…" }                  something that will bite if ignored
 *   { table: { head: [...], rows: [[...], …] } }
 *   { entry: { title, lines: [{ account, debit, credit }], foot } }
 *                                  a double-entry illustration
 *   { flow: ["Customer", "Sales Invoice", …] }   a top-to-bottom flow diagram
 */

export const GUIDE_SECTIONS = [
  // ══════════════════════════════════════════════════════════════ SETUP ══
  {
    id: "understanding",
    group: "Accounting setup",
    title: "Understanding accounting in this system",
    blocks: [
      { p: "You will never be asked to write a journal entry to run your business. You record the things that actually happen — you sold something, you bought something, you paid someone, someone paid you — and the system writes the accounting behind it." },
      { p: "There are only four everyday documents:" },
      {
        table: {
          head: ["What happened", "What you record", "Where"],
          rows: [
            ["You sold goods or services", "Invoice", "Sales → Invoices"],
            ["A customer paid you", "Receipt", "Accounting → Receipts"],
            ["A supplier billed you", "Purchase Bill", "Purchases → Purchase Bills"],
            ["You paid anyone, for anything", "Payment", "Accounting → Payments"],
          ],
        },
      },
      { p: "Everything else — balances, the customer's statement, tax totals, the profit figure — is calculated from those documents. You do not maintain it by hand." },
      { warn: "Automatic double-entry only runs when the General Ledger is switched on for the company. See “Switching on the General Ledger” below. Until it is on, invoices, bills and payments still work and balances are still correct — there is simply no ledger behind them yet." },
    ],
  },
  {
    id: "gl-switch",
    group: "Accounting setup",
    title: "Switching on the General Ledger",
    blocks: [
      { p: "The ledger is off by default so a company can start invoicing before its accounts are set up." },
      { path: "Dashboards → Accounting" },
      {
        steps: [
          "Open Dashboards → Accounting.",
          "If you see the banner “General Ledger is off”, click Enable GL posting.",
          "Wait for it to finish — it reads your existing invoices, bills and payments and writes the ledger entries for all of them, so this can take a minute.",
        ],
      },
      { note: "Switching it on is not destructive and it is not a one-way door — your documents are the source of truth and the ledger is rebuilt from them." },
      { p: "Once it is on, every invoice, bill, receipt and payment you save also writes its own journal entry, in the same save. If the document saves, the accounting saved with it." },
    ],
  },
  {
    id: "receipts-vs-payments",
    group: "Accounting setup",
    title: "Receipts or Payments — which screen?",
    blocks: [
      { p: "The only question is **which way the money moved.** Nothing else." },
      {
        table: {
          head: ["Money", "Screen", "Button"],
          rows: [
            ["Came IN to you", "Accounting → Receipts", "Record Receipt"],
            ["Went OUT from you", "Accounting → Payments", "Record Payment"],
          ],
        },
      },
      { p: "Both screens then ask the same two questions — who, and what for — so once you can use one you can use the other." },
      { p: "**Every situation, and where it goes:**" },
      {
        table: {
          head: ["Situation", "Screen", "What is this for?"],
          rows: [
            ["A customer paid an invoice", "Receipts", "Settle unpaid invoices"],
            ["A customer paid part of an invoice", "Receipts", "Settle unpaid invoices — enter the part"],
            ["A customer paid before you invoiced", "Receipts", "Advance / on account"],
            ["You sold scrap / got a rebate / interest", "Receipts", "Other income"],
            ["A supplier refunded you", "Receipts", "Advance / on account (payee = Supplier)"],
            ["You paid a supplier's bill", "Payments", "Settle unpaid bills"],
            ["You paid part of a supplier's bill", "Payments", "Settle unpaid bills — enter the part"],
            ["You paid a supplier before their bill", "Payments", "Advance / on account"],
            ["You paid rent, electricity, salaries…", "Payments", "An expense"],
            ["You refunded a customer", "Payments", "Advance / on account (payee = Client)"],
            ["The bank took charges", "Payments", "An expense"],
          ],
        },
      },
      { warn: "A receipt can never settle a purchase bill, and a payment can never settle a sales invoice — money in cannot pay a debt you owe. The system enforces this, and if the option is missing that is why." },
      { note: "Both screens support Cash, Bank Transfer, Cheque, Online and Other. A cheque with a future date is treated as post-dated and shown as Pending until it clears." },
    ],
  },
  {
    id: "coa",
    group: "Accounting setup",
    title: "Chart of Accounts — the foundation",
    blocks: [
      { p: "The Chart of Accounts is the list of buckets your money is sorted into. Every figure in every report comes from one of them." },
      { path: "Accounting → Chart of Accounts" },
      { p: "Accounts are grouped by the six things any business has:" },
      {
        table: {
          head: ["Group", "Means", "Examples here"],
          rows: [
            ["Assets", "What you own or are owed", "Bank & Cash, Accounts receivable, Inventory on hand, Prepaid expenses"],
            ["Liabilities", "What you owe", "Accounts payable, Output Sales Tax, Loans payable"],
            ["Equity", "The owner's stake", "Owner's capital, Owner drawings, Retained earnings"],
            ["Income", "What you earned", "Sales, Service revenue, Other income"],
            ["Cost of Sales", "What the goods you sold cost you", "Cost of goods sold"],
            ["Expenses", "The cost of running the business", "Rent, Electricity, Salaries, Internet, Bank charges"],
          ],
        },
      },
      { p: "**You do not have to build this from scratch.** A new company can load a ready-made set in one click." },
      {
        steps: [
          "Open Accounting → Chart of Accounts.",
          "If the company has no accounts yet you will see “No chart of accounts yet” with a Wholesale / Distribution button — click it.",
          "You now have the full set: the control accounts the system needs, plus the everyday income and expense categories.",
        ],
      },
      { p: "Then adjust it to your business — rename what doesn't fit, and add what's missing." },
    ],
  },
  {
    id: "creating-accounts",
    group: "Accounting setup",
    title: "Creating an account",
    blocks: [
      { path: "Accounting → Chart of Accounts → New Account" },
      {
        steps: [
          "Open Accounting → Chart of Accounts.",
          "Click New Account.",
          "Name — what you want to see on reports, e.g. “Electricity”.",
          "Statement — Balance Sheet for things you own or owe; Profit and Loss for income and expenses.",
          "Group — which section it belongs under, e.g. Expenses.",
          "Type — Asset, Liability, Equity, Income or Expense. Fixed after creation, so pick carefully.",
          "Control type — leave this alone. See the warning below.",
          "Opening balance and Side — only if you are carrying a balance in from your old books. Leave blank otherwise.",
          "Click Save.",
        ],
      },
      { p: "Need a whole new section rather than one account? Use **New Group** on the same screen." },
      { warn: "Control type marks an account as maintained by the system — Accounts receivable, Accounts payable, Bank & Cash, Input/Output tax. Those are filled in automatically from your invoices, bills and payments. Never create a second one and never post to one directly; the system will stop you if you try." },
      { note: "Type and Control type are shown as “Fixed after creation” because reports and the ledger already depend on them." },
    ],
  },
  {
    id: "managing-accounts",
    group: "Accounting setup",
    title: "Managing accounts — rename, tidy, retire",
    blocks: [
      { path: "Accounting → Chart of Accounts" },
      { p: "**Renaming.** Open the account and change its Name. Safe at any time — every past transaction follows the new name, because they point at the account, not at the text." },
      { p: "**What you cannot change** after creation is **Type** and **Control type**. Both are marked “Fixed after creation” on the form, because reports and the ledger are already built on them. Wrong type? Create the right account and move the transactions to it." },
      { p: "**Retiring one you no longer use.** Deactivate rather than delete — it disappears from the pickers while its history stays readable. Delete only works on an account nothing has ever touched; anything with transactions is blocked, and control accounts can never be deleted." },
      { p: "**Opening balances.** If you are moving from another system, set each account's Opening balance and Side (Debit for things you own, Credit for what you owe). Get these right once and Trial Balance will tie." },
      { p: "**Grouping.** Use New Group to add a section, then set an account's Group to file it there. Every account picker in the app shows the group beside the account name, so a clear group makes the pickers easier to read." },
      { note: "How many accounts is right? Enough that a report tells you something, few enough that choosing is obvious. Twenty to forty expense accounts is normal; two hundred is a filing system nobody will maintain." },
    ],
  },
  {
    id: "managing-expenses",
    group: "Accounting setup",
    title: "Managing expenses over time",
    blocks: [
      { p: "Recording an expense is one screen. Keeping expenses **useful** is a habit, and it comes down to three things." },
      { p: "**1. Always pick the same account for the same kind of cost.** If electricity sometimes goes to Electricity and sometimes to Utilities, neither total means anything. When in doubt, open the account's ledger and see where you put it last time." },
      { path: "Accounting → Chart of Accounts → click the account" },
      { p: "**2. Record the payee, even for one-offs.** Choosing Someone else and typing the name costs two seconds and makes the payment findable later. A blank payee is a payment nobody can explain in six months." },
      { p: "**3. Only claim tax you can prove.** Set Tax % where the supplier gave you a proper tax invoice with their STRN. Otherwise leave it blank — an over-claim is a problem at filing time, while an under-claim is just a slightly higher expense." },
      { p: "**Reviewing.** Once a month, open Trial Balance for the period and read down the expense accounts. Anything surprising, click through to that account's ledger and find the entry." },
      { path: "Reports → Accounting Reports → Trial Balance" },
      { p: "**Fixing.** Wrong account, wrong amount, wrong payee — open the payment from Accounting → Payments and edit it. The ledger is rewritten to match. Never patch an expense with a journal entry." },
      { warn: "A cost that keeps being coded to Miscellaneous is telling you it deserves its own account. Create one — you will want that total eventually." },
    ],
  },
  {
    id: "bank-cash",
    group: "Accounting setup",
    title: "Bank and Cash accounts",
    blocks: [
      { p: "These are the real accounts money moves through — your bank account, the cash drawer, a petty-cash tin. They are what you choose as the **Payment account** when you record money in or out." },
      { path: "Accounting → Bank & Cash Accounts → New Bank / Cash Account" },
      {
        steps: [
          "Open Accounting → Bank & Cash Accounts.",
          "Click New Bank / Cash Account.",
          "Give it the name you'll recognise — “Meezan Bank – Current”, “Cash in hand”, “Petty cash”.",
          "Opening Balance — what was actually in it on the day you started using the system.",
          "Click Save.",
        ],
      },
      { p: "The list then shows, per account: **Actual balance**, plus **Pending In** and **Pending Out** for cheques written or received but not yet cleared." },
      { note: "Have a bank account you no longer use? Use Deactivate rather than deleting it — history stays intact and it stops appearing in the pickers." },
    ],
  },
  {
    id: "ar-ap",
    group: "Accounting setup",
    title: "Accounts Receivable and Accounts Payable",
    blocks: [
      { p: "**Accounts receivable** is the total your customers owe you. **Accounts payable** is the total you owe your suppliers. Both already exist in the Chart of Accounts and both are filled in for you." },
      {
        table: {
          head: ["Account", "Goes up when", "Goes down when"],
          rows: [
            ["Accounts receivable", "You raise an invoice", "The customer pays"],
            ["Accounts payable", "You enter a purchase bill", "You pay the supplier"],
          ],
        },
      },
      { p: "There is nothing to configure. You never pick these accounts yourself — choosing the customer on an invoice, or the supplier on a bill, is what tells the system whose balance to move." },
      { warn: "Do not create your own “Receivables” or “Payables” account and do not post to these directly. Each customer's and supplier's share of the balance is tracked underneath; a manual posting would not belong to anybody and your statements would stop adding up." },
    ],
  },
  {
    id: "revenue-accounts",
    group: "Accounting setup",
    title: "Revenue accounts",
    blocks: [
      { p: "Revenue is what you earned. The preset gives you three, which is enough for most businesses:" },
      {
        bullets: [
          "**Sales** — goods you sell. This is where invoice amounts land by default.",
          "**Service revenue** — labour, installation, consulting.",
          "**Other income** — anything that isn't your normal trade: a rebate, scrap sales, interest.",
        ],
      },
      { p: "Want sales split by line of business — “Sales – Hardware”, “Sales – Electrical”? Create them as Income accounts, then map your item types to them so invoices split automatically." },
      { path: "Master Data → Item Types" },
    ],
  },
  {
    id: "expense-accounts",
    group: "Accounting setup",
    title: "Expense accounts",
    blocks: [
      { p: "One account per kind of cost you want to see on a report. The preset already includes the usual ones:" },
      { p: "Salaries · Rent · Utilities · Electricity · Internet · Telephone · Office supplies · Travel & conveyance · Repairs & maintenance · Marketing & advertising · Professional fees · Freight / Cartage · Commission · Bank charges · Depreciation · Miscellaneous" },
      { p: "The test for whether you need a new one is simple: **would you want to see that total on its own line in a report?** If yes, create it. If no, put it in Miscellaneous." },
      { note: "Don't create an account per supplier. “Electricity” is the account; K-Electric is the payee. One account, many suppliers." },
    ],
  },
  {
    id: "tax-accounts",
    group: "Accounting setup",
    title: "Tax accounts",
    blocks: [
      { p: "Two accounts, and the system maintains both:" },
      {
        table: {
          head: ["Account", "What it holds", "Filled in from"],
          rows: [
            ["Output Sales Tax", "Tax you charged customers and owe to FBR", "Sales invoices"],
            ["Input Sales Tax", "Tax you paid suppliers and can reclaim", "Purchase bills, and expenses with a tax rate"],
          ],
        },
      },
      { p: "What you owe FBR for the period is Output Sales Tax minus Input Sales Tax." },
      { p: "There is no separate tax-rate setup screen: **you enter the tax rate on the document itself.** An invoice and a purchase bill each carry one GST rate for the document; an expense line carries its own Tax %." },
      { path: "Reports → Tax Sheet" },
      { note: "Withholding tax is handled separately — see Sales → Withholding Tax and the WHT receivable / WHT payable accounts." },
    ],
  },
  {
    id: "inventory-cogs",
    group: "Accounting setup",
    title: "Inventory and Cost of Sales",
    blocks: [
      { p: "If you buy goods to resell, two more accounts matter:" },
      {
        bullets: [
          "**Inventory on hand** (Asset) — what your unsold stock cost you. Goes up when you buy, down when you sell.",
          "**Cost of goods sold** (Cost of Sales) — what the goods you actually sold cost you.",
        ],
      },
      { p: "Both are in the preset. Inventory on hand is a control account, kept in step with your stock records — never post to it by hand." },
      { path: "Dashboards → Inventory" },
      { note: "Stock tracking has a per-company setting for which item types count as inventory. If your purchases should be hitting Inventory on hand and are not, that setting is the first thing to check." },
    ],
  },
  {
    id: "verify-setup",
    group: "Accounting setup",
    title: "Checklist — is the setup ready?",
    blocks: [
      { p: "Walk this list once. If every line passes, you can record anything." },
      {
        table: {
          head: ["#", "Check", "Where to look"],
          rows: [
            ["1", "The Chart of Accounts is not empty", "Accounting → Chart of Accounts"],
            ["2", "Accounts receivable and Accounts payable both exist", "Accounting → Chart of Accounts"],
            ["3", "Input Sales Tax and Output Sales Tax both exist", "Accounting → Chart of Accounts"],
            ["4", "At least one bank or cash account exists", "Accounting → Bank & Cash Accounts"],
            ["5", "The expense categories you care about exist", "Accounting → Chart of Accounts"],
            ["6", "The General Ledger is on (no “General Ledger is off” banner)", "Dashboards → Accounting"],
            ["7", "Trial Balance opens and the Debit and Credit totals match", "Reports → Accounting Reports"],
          ],
        },
      },
      { warn: "If Trial Balance shows a balance sitting in **Suspense**, something was recorded that the system could not classify — usually data brought in from older books. It is safe to keep trading, but clear it before you rely on the numbers." },
    ],
  },

  // ══════════════════════════════════════════════════════════════ SALES ══
  {
    id: "create-customer",
    group: "Sales",
    title: "Adding a customer",
    blocks: [
      { path: "Master Data → Clients" },
      {
        steps: [
          "Open Master Data → Clients.",
          "Add the client with their name and, for a sales-tax invoice, their NTN and STRN.",
          "Save.",
        ],
      },
      { note: "In this system a customer is called a **Client**. Same thing." },
      { p: "Adding a client creates no accounting on its own. Their balance appears the moment you raise their first invoice." },
    ],
  },
  {
    id: "create-invoice",
    group: "Sales",
    title: "Creating a Sales Invoice",
    blocks: [
      { path: "Sales → Invoices" },
      {
        steps: [
          "Open Sales → Invoices.",
          "Start a new invoice and choose the Client.",
          "Add the lines — description, quantity, unit price.",
          "Set the GST rate for the invoice (18% is the standard rate).",
          "Save.",
        ],
      },
      { p: "That's the whole job. You do not touch Accounts receivable, Sales or the tax account — choosing the client and saving is what drives all three." },
    ],
  },
  {
    id: "invoice-accounting",
    group: "Sales",
    title: "How Sales Invoice accounting works",
    blocks: [
      { p: "You invoice a customer Rs 100,000 for goods plus 18% GST, so Rs 118,000 in total. The moment you save, the system records:" },
      {
        entry: {
          title: "Invoice #1041 — 18% GST",
          lines: [
            { account: "Accounts receivable (that customer)", debit: "118,000", credit: "" },
            { account: "Sales", debit: "", credit: "100,000" },
            { account: "Output Sales Tax", debit: "", credit: "18,000" },
          ],
          foot: "The customer owes 118,000. You earned 100,000. You owe FBR 18,000.",
        },
      },
      { p: "Reading that in plain words: the customer owing you more is a **debit** to receivables; earning income and owing tax are **credits**. Every entry the system writes has equal debits and credits — that is the check that nothing was lost." },
      { p: "**When it happens.** On save. There is no separate posting or confirming step — saving the invoice is the posting. Revenue is recognised then, not when the customer pays." },
      { p: "**The customer's balance** updates immediately, and the invoice appears on their statement as a debit with a running balance." },
      { path: "Master Data → Clients → open the client → Statement" },
      { p: "**Where the tax goes.** The 18,000 sits in Output Sales Tax until the period is filed. Reports → Tax Sheet is the working." },
      { note: "Sending the invoice to FBR is a separate step and does not change the accounting — see Sales → Invoices and Dashboards → FBR Monitor." },
      { warn: "Invoices marked as demo, and cancelled invoices, are deliberately excluded from the ledger and from every dashboard figure." },
      { p: "**If there is withholding tax.** When the customer withholds income tax at source, receivables are split: they only owe you the net, and the withheld slice moves to WHT receivable as something you reclaim from FBR." },
    ],
  },
  {
    id: "customer-ledger",
    group: "Sales",
    title: "The Customer Ledger",
    blocks: [
      { path: "Master Data → Clients → open the client → Statement" },
      { p: "The Statement tab is that customer's account with you, in date order: invoices as debits, receipts as credits, and a running balance. This is the screen to open when a customer disputes what they owe." },
      { p: "For everyone at once, with an age breakdown:" },
      { path: "Reports → Accounting Reports → Receivables" },
    ],
  },
  {
    id: "record-receipt",
    group: "Sales",
    title: "Recording a customer payment",
    blocks: [
      { p: "The customer owes Rs 118,000 and pays it into your bank." },
      { path: "Accounting → Receipts → Record Receipt" },
      {
        steps: [
          "Open Accounting → Receipts and click Record Receipt.",
          "Who paid you? — leave it on Client and pick the customer.",
          "What is this money for? — Settle unpaid invoices.",
          "Date — the day the money arrived.",
          "Method — Cash, Bank Transfer, Cheque, Online or Other.",
          "Received in (bank/cash) — the account the money landed in.",
          "Their unpaid invoices are listed. Type the amount received against the right one.",
          "Description, and an attachment if you want the deposit slip on file.",
          "Save.",
        ],
      },
      {
        entry: {
          title: "Receipt RCP-0007 — 118,000 against Invoice #1041",
          lines: [
            { account: "Bank", debit: "118,000", credit: "" },
            { account: "Accounts receivable (that customer)", debit: "", credit: "118,000" },
          ],
          foot: "Bank up 118,000. The customer now owes nothing. The invoice shows Paid.",
        },
      },
      { p: "Before: receivable 118,000. After: receivable 0, bank 118,000 higher. No tax is involved — the tax was already recorded when you raised the invoice." },
      { warn: "One receipt covers one customer. If a cheque covers two customers, record two receipts." },
    ],
  },
  {
    id: "partial-payment",
    group: "Sales",
    title: "Partial payment",
    blocks: [
      { p: "Same invoice of Rs 118,000, but the customer pays Rs 50,000." },
      { p: "Record it exactly as above and type **50,000** instead of the full amount." },
      {
        entry: {
          title: "Receipt — 50,000 against Invoice #1041",
          lines: [
            { account: "Bank", debit: "50,000", credit: "" },
            { account: "Accounts receivable (that customer)", debit: "", credit: "50,000" },
          ],
          foot: "Receivable falls from 118,000 to 68,000. The invoice shows Partial.",
        },
      },
      { p: "Pay the rest later with a second receipt against the same invoice. The invoice flips to **Paid** when the balance reaches zero. Both receipts stay on the customer's statement." },
      { p: "**If they are never going to pay the rest.** Enter the cash you did get, then use the write-off option on the line to send the shortfall to an account such as Discount allowed or Bad debts written off. The invoice then shows as fully settled while only the real cash is recorded." },
    ],
  },
  {
    id: "advance-receipt",
    group: "Sales",
    title: "Advance received from a customer",
    blocks: [
      { p: "A customer pays Rs 50,000 up front and there is no invoice yet." },
      { path: "Accounting → Receipts → Record Receipt" },
      {
        steps: [
          "Who paid you? — Client, and pick the customer.",
          "What is this money for? — Advance / on account.",
          "Received in (bank/cash) — where the money landed.",
          "Advance amount — 50,000.",
          "Save.",
        ],
      },
      {
        entry: {
          title: "Receipt — 50,000 advance",
          lines: [
            { account: "Bank", debit: "50,000", credit: "" },
            { account: "Accounts receivable (that customer)", debit: "", credit: "50,000" },
          ],
          foot: "The customer's balance is now 50,000 in credit — you owe them goods.",
        },
      },
      { p: "When you later invoice them, the invoice pushes their balance back the other way and the advance is absorbed. Their statement shows both." },
      { note: "No income and no tax is recorded by an advance. You have not earned anything yet — that happens on the invoice." },
    ],
  },
  {
    id: "overpayment",
    group: "Sales",
    title: "Overpayment",
    blocks: [
      { p: "A customer pays more than the invoice. The system will not let you apply more than an invoice's balance to it — that would make the invoice look overpaid and hide the extra." },
      { p: "Record it as two lines of one receipt instead:" },
      {
        steps: [
          "Settle unpaid invoices — enter the exact invoice balance.",
          "Save, then record a second receipt for the remainder with What is this money for? — Advance / on account.",
        ],
      },
      { p: "The invoice shows Paid, and the extra sits as a credit on the customer's balance ready for their next invoice — or to be refunded." },
      { p: "**Refunding it.** Accounting → Payments → Record Payment, Who are you paying? — Client, pick them, and choose Advance / on account. That moves the money out of the bank and clears the credit." },
    ],
  },
  {
    id: "sales-tax",
    group: "Sales",
    title: "How tax works on sales",
    blocks: [
      { p: "You set one GST rate per invoice. 18% is the standard rate. The system splits the total into the net amount and the tax." },
      {
        table: {
          head: ["Invoice total", "Rate", "Sales", "Output Sales Tax"],
          rows: [
            ["118,000", "18%", "100,000", "18,000"],
            ["100,000", "0% / exempt", "100,000", "nil"],
          ],
        },
      },
      { p: "Tax is recorded when the invoice is saved, not when the customer pays. A receipt never touches the tax account." },
      { path: "Reports → Tax Sheet" },
    ],
  },

  // ══════════════════════════════════════════════════════════ PURCHASES ══
  {
    id: "create-supplier",
    group: "Purchases",
    title: "Adding a supplier",
    blocks: [
      { path: "Master Data → Suppliers" },
      {
        steps: [
          "Open Master Data → Suppliers.",
          "Add the supplier with their name, and their NTN/STRN if you will be reclaiming input tax.",
          "Save.",
        ],
      },
      { p: "No accounting happens until you enter their first bill." },
    ],
  },
  {
    id: "create-purchase-bill",
    group: "Purchases",
    title: "Creating a Purchase Bill",
    blocks: [
      { p: "Use a Purchase Bill when a supplier has billed you and you will pay later — it records the debt now and the payment separately." },
      { path: "Purchases → Purchase Bills" },
      {
        steps: [
          "Open Purchases → Purchase Bills.",
          "Start a new bill and choose the Supplier.",
          "Add the lines — what you bought, quantity, unit price.",
          "Set the account each line belongs to: an inventory item type for goods to resell, or an expense account for anything else.",
          "Set the GST rate for the bill.",
          "Save.",
        ],
      },
    ],
  },
  {
    id: "purchase-accounting",
    group: "Purchases",
    title: "How Purchase Bill accounting works",
    blocks: [
      { p: "A supplier bills you Rs 100,000 for stock plus 18% GST — Rs 118,000." },
      {
        entry: {
          title: "Bill #308 — stock, 18% GST",
          lines: [
            { account: "Inventory on hand", debit: "100,000", credit: "" },
            { account: "Input Sales Tax", debit: "18,000", credit: "" },
            { account: "Accounts payable (that supplier)", debit: "", credit: "118,000" },
          ],
          foot: "Stock up 100,000. Reclaimable tax 18,000. You owe the supplier 118,000.",
        },
      },
      { p: "If the bill was for a service or a running cost rather than stock, the first line goes to that expense account instead of Inventory on hand — everything else is identical." },
      { p: "**When it happens.** On save, like an invoice. **The supplier's balance** goes up straight away and the bill shows Unpaid." },
      { p: "**Nothing has left your bank yet.** That is the whole point of a bill: the debt is recorded now, the cash later." },
      { p: "**If you withhold tax** when paying this supplier, payables are split — you owe the supplier only the net, and the withheld slice becomes WHT payable that you remit to FBR." },
      { path: "Reports → Accounting Reports → Payables" },
    ],
  },
  {
    id: "supplier-ledger",
    group: "Purchases",
    title: "The Supplier Ledger",
    blocks: [
      { path: "Reports → Accounting Reports → Payables" },
      { p: "Payables lists every supplier with what you owe them and how old it is." },
      { p: "For the full movement on one supplier, open the Accounts payable account's ledger and read the entries tagged to them:" },
      { path: "Accounting → Chart of Accounts → click Accounts payable" },
      { note: "A single-supplier statement screen, like the customer's Statement tab, is not built yet. Payables plus the Accounts payable ledger give you the same figures today." },
    ],
  },
  {
    id: "supplier-payment",
    group: "Purchases",
    title: "Paying a supplier",
    blocks: [
      { p: "You owe Rs 118,000 on Bill #308 and you pay it from the bank." },
      { path: "Accounting → Payments → Record Payment" },
      {
        steps: [
          "Open Accounting → Payments and click Record Payment.",
          "Who are you paying? — Supplier, and pick them.",
          "What is this payment for? — Settle unpaid bills.",
          "Paid from (bank/cash) — the account the money left.",
          "Their unpaid bills are listed. Enter the amount against the right one.",
          "Save.",
        ],
      },
      {
        entry: {
          title: "Payment PMT-0112 — 118,000 against Bill #308",
          lines: [
            { account: "Accounts payable (that supplier)", debit: "118,000", credit: "" },
            { account: "Bank", debit: "", credit: "118,000" },
          ],
          foot: "You owe nothing. Bank down 118,000. The bill shows Paid.",
        },
      },
      { p: "**No tax line.** The input tax was recorded when you entered the bill; paying it does not touch tax again." },
      {
        bullets: [
          "**Partial payment** — enter less than the balance. The bill shows Partial and the rest stays owing.",
          "**Several bills at once** — one payment can clear as many of that supplier's bills as you like. Enter an amount against each; the total is what leaves the bank.",
          "**Advance to a supplier** — choose Advance / on account instead, and enter the amount. See the next section.",
          "**A discount they gave you** — enter the cash you actually paid, then use the write-off option on the line to send the difference to Discount received. The bill shows fully settled.",
        ],
      },
      { warn: "One payment covers one supplier. Paying three suppliers with three cheques means three payments." },
    ],
  },
  {
    id: "supplier-advance",
    group: "Purchases",
    title: "Advance paid to a supplier",
    blocks: [
      { p: "A supplier wants Rs 30,000 up front before they ship, and there is no bill yet." },
      {
        steps: [
          "Accounting → Payments → Record Payment.",
          "Who are you paying? — Supplier, and pick them.",
          "What is this payment for? — Advance / on account.",
          "Paid from (bank/cash), then Advance amount — 30,000.",
          "Save.",
        ],
      },
      {
        entry: {
          title: "Payment — 30,000 advance",
          lines: [
            { account: "Accounts payable (that supplier)", debit: "30,000", credit: "" },
            { account: "Bank", debit: "", credit: "30,000" },
          ],
          foot: "Bank down 30,000. The supplier's balance is 30,000 in your favour.",
        },
      },
      { p: "When their bill arrives, enter it as normal. The bill pushes their balance back the other way and the advance is absorbed — you only pay the difference." },
      { warn: "Do not record an advance as an expense. Nothing has been consumed yet; you have simply moved money into the supplier's hands, and it must stay visible as something they owe you." },
    ],
  },
  {
    id: "purchase-tax",
    group: "Purchases",
    title: "How tax works on purchases",
    blocks: [
      { p: "The GST on a purchase bill goes to **Input Sales Tax** — tax you have paid and can set against the tax you charged." },
      { p: "What you remit for the period is Output Sales Tax minus Input Sales Tax." },
      {
        table: {
          head: ["Document", "Rate you set", "Tax account used"],
          rows: [
            ["Sales invoice", "GST rate on the invoice", "Output Sales Tax"],
            ["Purchase bill", "GST rate on the bill", "Input Sales Tax"],
            ["Expense (money out)", "Tax % on the line", "Input Sales Tax"],
            ["Other income (money in)", "Tax % on the line", "Output Sales Tax"],
          ],
        },
      },
      { warn: "Only claim input tax where the supplier actually gave you a tax invoice with their STRN. If in doubt, leave Tax % blank and book the whole amount as the expense." },
    ],
  },

  // ═══════════════════════════════════════════════════════════ EXPENSES ══
  {
    id: "purchase-vs-expense",
    group: "Expenses",
    title: "Purchase or expense? — read this first",
    blocks: [
      { p: "This is the single most common thing to get wrong, and it is easy once you see it. The question is not what you bought — it is **whether you are recording a debt or a payment.**" },
      {
        table: {
          head: ["Situation", "Record", "Where"],
          rows: [
            ["A supplier billed you, you'll pay later", "Purchase Bill, then a Payment later", "Purchases → Purchase Bills"],
            ["You paid on the spot and owe nothing", "Payment, with What is this for? = An expense", "Accounting → Payments"],
            ["You're paying off a bill you already entered", "Payment, with Settle unpaid bills", "Accounting → Payments"],
          ],
        },
      },
      { p: "So:" },
      {
        bullets: [
          "**Buying stock for resale on credit** → Purchase Bill. It has to hit Inventory on hand and it has to show as owing.",
          "**Paying the electricity bill by transfer** → Payment → An expense. Nothing was ever owed on your books.",
          "**Bought stationery with petty cash** → Payment → An expense. No bill needed.",
          "**Stock arrived with an invoice you'll pay in 30 days** → Purchase Bill now, Payment in 30 days.",
        ],
      },
      { note: "Rule of thumb: if you'd chase it in an “unpaid bills” list, it's a Purchase Bill. If it's already dealt with, it's a Payment." },
      { warn: "Do not enter a Purchase Bill and then also record the same spend as an expense — that counts the cost twice and leaves a phantom debt. Enter the bill, then settle it." },
    ],
  },
  {
    id: "payee-types",
    group: "Expenses",
    title: "Payee: Client, Supplier or Someone else",
    blocks: [
      { p: "Every payment asks who the money went to. There are three answers, and the only difference between them is whether that person is already on your books." },
      {
        table: {
          head: ["Choose", "When", "Example"],
          rows: [
            ["Supplier", "They are in Master Data → Suppliers", "Your regular stockist, your internet provider"],
            ["Client", "They are in Master Data → Clients", "Refunding a customer, returning an advance"],
            ["Someone else", "A one-off, not worth adding to your master data", "The landlord, a courier, reimbursing an employee"],
          ],
        },
      },
      { p: "Choosing Client or Supplier links the payment to that party, so it appears in their balance and their ledger. **Someone else** just records the name — nothing is added to your Clients or Suppliers." },
      { p: "Picking a Supplier does **not** force the payment to be about a bill. Paying a supplier for a one-off expense with no bill is completely normal: choose them, then choose An expense." },
      { note: "Getting the payee wrong does not corrupt anything — it only affects whose ledger the payment shows in. Edit the payment and change it." },
    ],
  },
  {
    id: "record-expense",
    group: "Expenses",
    title: "Recording an expense",
    blocks: [
      { p: "An electricity bill of Rs 11,600 including tax, paid from the bank." },
      { path: "Accounting → Payments → Record Payment" },
      {
        steps: [
          "Open Accounting → Payments and click Record Payment.",
          "Who are you paying? — Supplier if they're on your books, otherwise Someone else and type the name.",
          "What is this payment for? — An expense.",
          "Date — the day you paid.",
          "Method — Cash, Bank Transfer, Cheque, Online or Other.",
          "Paid from (bank/cash) — the account the money left.",
          "What was it for? — pick Electricity.",
          "Amount — 11,600, exactly as it appears on the bill, including tax.",
          "Tax % — 18 if you hold a valid tax invoice and can reclaim it; leave blank otherwise.",
          "Description — e.g. “K-Electric, March”. Attach the bill if you want it on file.",
          "Save.",
        ],
      },
      { p: "The form shows the split as you type, so you can see it is right before saving." },
      {
        entry: {
          title: "Payment — 11,600 electricity at 18%",
          lines: [
            { account: "Electricity", debit: "9,830.51", credit: "" },
            { account: "Input Sales Tax", debit: "1,769.49", credit: "" },
            { account: "Bank", debit: "", credit: "11,600" },
          ],
          foot: "The real cost of electricity was 9,830.51. The 1,769.49 tax is reclaimable. 11,600 left the bank.",
        },
      },
      { p: "**Several things on one payment.** Click **+ Add another line** — one payment can carry Electricity, Internet and Office supplies together, each with its own amount and tax." },
      { p: "**Without tax**, leave Tax % blank and the whole amount goes to the expense account:" },
      {
        entry: {
          title: "Payment — 11,600 electricity, no tax claimed",
          lines: [
            { account: "Electricity", debit: "11,600", credit: "" },
            { account: "Bank", debit: "", credit: "11,600" },
          ],
          foot: "Simpler, and correct when there's no valid tax invoice.",
        },
      },
      { warn: "Amount is always what actually left your bank — the gross, tax included. The Tax % carves the reclaimable slice out of it. Do not enter the net and expect the system to add tax on top." },
    ],
  },
  {
    id: "expense-ledger",
    group: "Expenses",
    title: "Where did my expense go?",
    blocks: [
      { p: "You recorded it. Here is how to follow it through, in three clicks." },
      {
        steps: [
          "Open Accounting → Chart of Accounts.",
          "Click the account you used — Electricity.",
          "The ledger opens: every payment posted to it, with dates, references and a running total.",
        ],
      },
      { p: "To check the money side instead, open the bank account's own ledger:" },
      { path: "Accounting → Bank & Cash Accounts → click the account" },
      { p: "And for the totals across a period — every account, opening, debit, credit and closing on one page:" },
      { path: "Reports → Accounting Reports → Trial Balance" },
    ],
  },

  // ═════════════════════════════════════════════════════════════ FLOWS ══
  {
    id: "flows",
    group: "How it fits together",
    title: "The three flows",
    blocks: [
      { p: "Everything in the system is one of these three shapes. You do the left-hand steps; the system does the rest." },
      { p: "**Selling**" },
      { flow: ["Client", "Sales Invoice", "Accounts receivable ↑ · Sales ↑ · Output Sales Tax ↑", "Receipt", "Bank ↑ · Accounts receivable ↓"] },
      { p: "**Buying on credit**" },
      { flow: ["Supplier", "Purchase Bill", "Inventory or Expense ↑ · Input Sales Tax ↑ · Accounts payable ↑", "Payment", "Accounts payable ↓ · Bank ↓"] },
      { p: "**Paying for something outright**" },
      { flow: ["Payee — Client, Supplier or Someone else", "Payment → An expense", "Expense account ↑ · Input Sales Tax ↑ (if claimed)", "Bank or Cash ↓"] },
      { p: "Notice the middle flow has two steps and the third has one. That is the only real difference between a purchase and an expense." },
    ],
  },
  {
    id: "examples",
    group: "How it fits together",
    title: "Ten worked examples",
    blocks: [
      { p: "What you do, where, and what the system records." },
      {
        table: {
          head: ["#", "Situation", "Screen and choices", "Recorded as"],
          rows: [
            ["1", "Office rent Rs 80,000 paid from bank", "Payments → Record Payment · Someone else “Landlord” · An expense · Rent · 80,000 · no tax", "Dr Rent 80,000 / Cr Bank 80,000"],
            ["2", "Electricity Rs 11,600 incl. 18% tax", "Payments → Record Payment · An expense · Electricity · 11,600 · Tax 18", "Dr Electricity 9,830.51 · Dr Input Tax 1,769.49 / Cr Bank 11,600"],
            ["3", "Internet Rs 5,900 incl. 18% tax", "Payments → Record Payment · Supplier · An expense · Internet · 5,900 · Tax 18", "Dr Internet 5,000 · Dr Input Tax 900 / Cr Bank 5,900"],
            ["4", "Stock Rs 118,000 incl. tax, on credit", "Purchase Bills → new bill · Supplier · stock lines · GST 18%", "Dr Inventory 100,000 · Dr Input Tax 18,000 / Cr Payables 118,000"],
            ["5", "Invoice a customer Rs 118,000 incl. tax", "Invoices → new invoice · Client · lines · GST 18%", "Dr Receivables 118,000 / Cr Sales 100,000 · Cr Output Tax 18,000"],
            ["6", "That customer pays Rs 50,000", "Receipts → Record Receipt · Client · Settle unpaid invoices · 50,000", "Dr Bank 50,000 / Cr Receivables 50,000 — invoice shows Partial"],
            ["7", "A customer pays Rs 50,000 in advance", "Receipts → Record Receipt · Client · Advance / on account · 50,000", "Dr Bank 50,000 / Cr Receivables 50,000 — customer in credit"],
            ["8", "Supplier bill received, not yet paid", "Purchase Bills → new bill · Supplier · lines · GST", "Dr Inventory or Expense · Dr Input Tax / Cr Payables — bill shows Unpaid"],
            ["9", "That bill paid a month later", "Payments → Record Payment · Supplier · Settle unpaid bills · full amount", "Dr Payables / Cr Bank — bill shows Paid"],
            ["10", "Bank charged Rs 250 in fees", "Payments → Record Payment · Someone else “Bank” · An expense · Bank charges · 250", "Dr Bank charges 250 / Cr Bank 250"],
          ],
        },
      },
      { note: "Examples 4 and 8 are the same shape — a bill creates a debt. Examples 1, 2, 3 and 10 are the same shape — a payment settles nothing because nothing was owed." },
    ],
  },

  // ═══════════════════════════════════════════════════════════ REPORTS ══
  {
    id: "reports",
    group: "Reports and checking",
    title: "Reports — where to see everything",
    blocks: [
      {
        table: {
          head: ["You want to see", "Where"],
          rows: [
            ["Every account with opening, debit, credit and closing", "Reports → Accounting Reports → Trial Balance"],
            ["What customers owe you, by age", "Reports → Accounting Reports → Receivables"],
            ["What you owe suppliers, by age", "Reports → Accounting Reports → Payables"],
            ["One customer's full history", "Master Data → Clients → open the client → Statement"],
            ["Every transaction on one account", "Accounting → Chart of Accounts → click the account"],
            ["A bank or cash account's movement and balance", "Accounting → Bank & Cash Accounts → click the account"],
            ["Sales tax for the period", "Reports → Tax Sheet"],
            ["Sales figures", "Reports → Sales Report"],
            ["Cash, receivables, payables and working capital at a glance", "Dashboards → Accounting"],
            ["Entries the system wrote, and manual ones", "Accounting → Journal Entries"],
          ],
        },
      },
      { p: "Expense and revenue totals for a period both come from Trial Balance — every expense account's closing figure is what you spent on it." },
    ],
  },
  {
    id: "tracing",
    group: "Reports and checking",
    title: "Tracing a transaction end to end",
    blocks: [
      { p: "**An expense you recorded.**" },
      { flow: ["Accounting → Payments — find the payment", "Accounting → Chart of Accounts — click the expense account", "The ledger shows the entry", "Reports → Accounting Reports → Trial Balance — it's in the account's closing figure"] },
      { p: "**An invoice you raised.**" },
      { flow: ["Sales → Invoices — find the invoice", "Master Data → Clients → Statement — it's a debit on their account", "Chart of Accounts → Accounts receivable — the ledger entry", "Chart of Accounts → Sales and Output Sales Tax — the income and the tax", "Reports → Tax Sheet — the tax in the period"] },
      { p: "**A purchase bill.**" },
      { flow: ["Purchases → Purchase Bills — find the bill", "Reports → Accounting Reports → Payables — the supplier's balance", "Chart of Accounts → Accounts payable — the ledger entry", "Chart of Accounts → Inventory on hand or the expense account, and Input Sales Tax"] },
    ],
  },
  {
    id: "troubleshooting",
    group: "Reports and checking",
    title: "When the numbers look wrong",
    blocks: [
      {
        table: {
          head: ["Symptom", "Usual cause", "Fix"],
          rows: [
            ["No ledger entries at all", "The General Ledger was never switched on", "Dashboards → Accounting → Enable GL posting"],
            ["A balance sitting in Suspense", "Something the system couldn't classify, usually migrated data", "Open the Suspense ledger, find the document, give its line a real account"],
            ["An expense missing from its account", "It went to a different account, or to a purchase bill instead", "Open the payment and check What was it for?"],
            ["A customer's balance too high", "A receipt was recorded against the wrong customer", "Master Data → Clients → Statement, find it, edit the receipt"],
            ["An invoice still Unpaid after payment", "The receipt was recorded as an advance, not against the invoice", "Edit the receipt and choose Settle unpaid invoices"],
            ["Input tax lower than expected", "Tax % was left blank on expenses", "Open each payment and set Tax %"],
            ["Trial Balance debits ≠ credits", "Should never happen — every entry is balanced on save", "Report it; do not adjust by hand"],
          ],
        },
      },
      { p: "**Editing something already recorded.** Open it and change it — the system rewrites its accounting to match. Two things stop you:" },
      {
        bullets: [
          "**A closed period.** If a lock date has been set, documents on or before it cannot be changed. Record a correction in an open period instead.",
          "**Permissions.** Recording and deleting are separate rights, so you may be able to add but not remove.",
        ],
      },
      { warn: "Never fix a wrong payment with a journal entry. Edit the payment. A journal entry on top leaves the document and the ledger disagreeing, and the next person will not know which is right." },
    ],
  },
  {
    id: "glossary",
    group: "Reports and checking",
    title: "Glossary — the words that get confused",
    blocks: [
      {
        table: {
          head: ["Term", "What it actually is", "Example"],
          rows: [
            ["Chart of Accounts", "The list of categories your money is sorted into", "Electricity, Sales, Bank, Accounts receivable"],
            ["Client", "Someone who buys from you", "Ali Traders"],
            ["Supplier", "Someone you buy from", "Burhani Safety"],
            ["Payee", "Whoever a payment went to — a client, a supplier, or anyone else", "The landlord"],
            ["Payment account", "The bank or cash account the money moved through", "Meezan Bank – Current"],
            ["Expense account", "The category the cost is recorded under", "Electricity"],
            ["Accounts receivable", "The total your customers owe you", "Kept automatically"],
            ["Accounts payable", "The total you owe suppliers", "Kept automatically"],
            ["Output tax", "Tax you charged customers and owe FBR", "From invoices"],
            ["Input tax", "Tax you paid suppliers and can reclaim", "From bills and expenses"],
          ],
        },
      },
      { p: "The three that trip people up most: **Payee** is a person, **Payment account** is where the money came from, **Expense account** is what it was for. A single payment has all three — “paid the landlord, from the bank, for rent”." },
    ],
  },
];

/** Sidebar groups, in the order they should appear. */
export const GUIDE_GROUPS = [
  "Accounting setup",
  "Sales",
  "Purchases",
  "Expenses",
  "How it fits together",
  "Reports and checking",
];
