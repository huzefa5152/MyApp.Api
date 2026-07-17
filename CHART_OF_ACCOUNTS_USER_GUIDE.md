# Chart of Accounts — User Guide

A plain-English guide to the **Chart of Accounts** (CoA) in the app: what it is, how
to read it, how to create accounts and groups, what every field on the form means
(with examples), and how each account is used and tracked.

> Where: **Accounting → Chart of Accounts**. Bank/cash accounts also have their own
> friendlier screen at **Accounting → Bank & Cash Accounts**.

---

## 1. What is the Chart of Accounts?

The Chart of Accounts is the **master list of every "bucket" your money can sit in or
flow through** — your bank accounts, what customers owe you, what you owe suppliers,
your sales, your expenses, your capital, and so on. Every invoice, bill, receipt,
payment, and journal ultimately moves money between these buckets. The CoA is the
backbone of your accounting: your **Balance Sheet** and **Profit & Loss** are just
these accounts, added up.

The screen has **two columns**:

- **Balance Sheet** — what you *own and owe* right now: **Assets**, **Liabilities**,
  **Equity**.
- **Profit & Loss** — how you're *performing over time*: **Income** and **Expenses**.

Within each, accounts are organised into **groups** (e.g. an "Assets" group holding
"Accounts receivable", "Cash", etc.), and groups can have **sub-groups**.

---

## 2. The five account types (with examples)

Every account is one of five **types**. The type decides which statement/column it
appears in and its "normal" direction.

| Type | Column | What it is | Examples |
|---|---|---|---|
| **Asset** | Balance Sheet | Things you own / money owed to you | Bank accounts, Cash, Accounts receivable, Inventory, Advances paid |
| **Liability** | Balance Sheet | Money you owe | Accounts payable, Sales tax payable, Loans |
| **Equity** | Balance Sheet | The owners' stake | Capital, Retained earnings, Drawings |
| **Income** | Profit & Loss | Money you earn | Sales, Freight recovered, Interest received |
| **Expense** | Profit & Loss | Money you spend to run the business | Rent, Salaries, Cartage, Bank charges, Cost of sales |

---

## 3. Reading the screen

- **Amounts show in their natural sign.** Income, Liabilities, and Equity show as
  **positive** (that's their normal side), just like a printed balance sheet.
- **Brackets `( )` mean the balance is running the "wrong" way** for its type — e.g. a
  bank account that's overdrawn shows `(10,306,052.29)`, or an expense account with a
  refund/credit balance. It's not an error; it just means "opposite of normal".
- **Group headers show a subtotal** = the sum of the accounts (and sub-groups) inside.
- **"Current-Year Earnings"** appears automatically inside **Equity** = your net
  profit so far (Income − Expenses). This is how the balance sheet stays balanced
  without you closing the books.
- **GL chip** at the top:
  - **"GL on · N entries"** — the ledger is live; balances = opening balance + posted
    transactions.
  - **"GL off — balances show opening only"** — posting engine is off; balances show
    just the opening balances you entered. (Click **Enable GL** to turn it on.)
- **Click any account row** to open its **ledger** — every transaction that hit it,
  with a running balance. This is the drill-down behind the number.

---

## 4. Control accounts (what makes an account "special")

Most accounts are ordinary. A few carry a **Control type** that tells the system to
route certain transactions to them automatically:

| Control type | Meaning — the system posts here automatically for… |
|---|---|
| **Accounts Receivable** | what customers owe (from invoices/receipts) |
| **Accounts Payable** | what you owe suppliers (from bills/payments) |
| **Bank & Cash** | a real bank account or cash drawer — appears in the **receipt/payment "Received in / Paid from" dropdown** |
| **Output Tax** | sales tax you charge customers |
| **Input Tax** | sales tax you pay suppliers |
| **Withholding Receivable / Payable** | tax withheld from you / by you |
| **Inventory** | stock value |
| **Capital / Retained Earnings** | owners' equity |
| **Suspense** | a temporary "parking" account for amounts not yet classified |
| **None** | an ordinary account (most income/expense accounts) |

**Rule of thumb:** set a Control type only for the special accounts above. Everyday
income and expense accounts should stay **None**. Marking an account **Bank & Cash** is
what makes it selectable when you record a receipt or payment.

---

## 5. Creating a new account — every field explained

**Chart of Accounts → New Account.** The form:

| Field | Required | What it means & how to fill it | Example |
|---|---|---|---|
| **Name** | ✅ | What the account is called. Use a clear, specific name. | `HBL — Current A/C 0123`, `Salaries`, `Sales — Retail` |
| **Group** | ✅ | Which group/section it lives under. Determines where it shows. Pick an existing group (create the group first if needed). | `Bank & Cash Accounts` (under Assets), `Expenses` |
| **Type** | ✅ | Asset / Liability / Equity / Income / Expense (see §2). **Fixed after creation** — choose carefully. | `Asset` for a bank; `Expense` for Rent |
| **Code** | optional | A short reference/number for the account, if you use a numbered chart. Leave blank if you don't. | `1010`, `5200` |
| **Control type** | optional | Usually **None**. Set only for special accounts (see §4). **Fixed after creation.** | `Bank & Cash` for a bank; `None` for Rent |
| **Opening balance** | optional | The balance the account already had when you start using the app (the amount as of your start date). Leave `0` for brand-new accounts. | `50000` for a bank that already holds Rs 50,000 |
| **Side** | ✅ if opening ≠ 0 | Is the opening balance a **Debit** or a **Credit**? See the cheat-sheet below. | Bank with money → **Debit**; a loan you owe → **Credit** |

**Debit or Credit? (opening balance cheat-sheet)**

- **Assets & Expenses are normally DEBIT.** A bank with money in it → Debit. Cash on
  hand → Debit.
- **Liabilities, Equity & Income are normally CREDIT.** A loan you owe → Credit.
  Owner's capital → Credit.
- If the account is running the opposite way (e.g. an **overdrawn** bank), use the
  other side (an overdrawn bank = Credit).

> **Type and Control type can't be changed after you create the account** (they affect
> how everything posts). Name, code, group, and balances can be edited later. If you
> picked the wrong type, delete and re-create the account.

---

## 6. Creating a group

**Chart of Accounts → New Group.**

| Field | What it means | Example |
|---|---|---|
| **Name** | The group heading. | `Bank & Cash Accounts`, `Operating Expenses` |
| **Statement** | **Balance Sheet** or **Profit & Loss** — which column the group (and its accounts) appears in. | Balance Sheet for asset groups; Profit & Loss for expense groups |
| **Parent group** (optional) | Nest this group inside another. Leave "Top level" for a main section. | Put "Bank & Cash Accounts" under "Assets" |

Groups are just organisation — they don't hold money themselves; their subtotal is the
sum of the accounts inside.

---

## 7. How an account is used and tracked

1. **You transact.** You raise an invoice, pay a bill, record a receipt, or write a
   journal. Each of these moves money between accounts (debit one, credit another).
2. **The system posts to the ledger.** When GL posting is on, every document creates a
   balanced **journal entry** against the relevant accounts (e.g. an invoice debits
   *Accounts receivable* and credits *Sales* + *Output tax*).
3. **Balances update.** An account's **balance = its opening balance + every posting
   that hit it.** That's the number you see on the CoA screen.
4. **You drill down.** Click the account → its **ledger** shows every line that made up
   the balance, with dates, references, and a running balance. Bank/cash accounts show
   this from the **Bank & Cash Accounts** screen too.

So: define the account once, choose its type/control correctly, and from then on the
app fills and tracks it automatically as you do business.

---

## 8. Bank & Cash accounts (the friendly screen)

**Accounting → Bank & Cash Accounts** is a focused view of just your bank/cash
accounts with live balances and one-click ledger drill-down. Any account with
**Control type = Bank & Cash** (under an asset group) shows here — and, importantly,
becomes selectable in the **"Received in / Paid from"** dropdown when you record a
**receipt or payment**. If that dropdown is empty, you have no Bank & Cash accounts
yet — create one here (or in the CoA) with Control type **Bank & Cash**.

You can create a bank/cash account directly from this screen (**New Bank / Cash
Account**) — it pre-selects the right type/control for you; you just enter the name,
optional code, group, and opening balance.

---

## 9. Worked examples

**A) Add a bank account that already holds Rs 250,000**
New Account → Name `Meezan — Current 4455`, Group `Bank & Cash Accounts`, Type `Asset`,
Control type `Bank & Cash`, Opening balance `250000`, Side `Debit`. → Now it shows on
the Bank & Cash screen and in receipt/payment dropdowns.

**B) Add a monthly expense account**
New Account → Name `Internet & Telephone`, Group `Expenses`, Type `Expense`, Control
type `None`, Opening balance `0`. → Pick it on payments/journals; its total builds up
over the year and shows under Expenses in the P&L.

**C) Add a new sales/income account**
New Account → Name `Sales — Wholesale`, Group `Income`, Type `Income`, Control type
`None`, Opening balance `0`. → Invoices coded to it accumulate here as positive income.

**D) Record the owner putting in Rs 1,000,000 capital**
Ensure an equity account `Capital` exists (Type `Equity`, Control `Capital`). Then a
receipt into the bank with the other side to `Capital` (or a journal: Dr Bank / Cr
Capital). Bank goes up (Debit), Capital goes up (Credit).

---

## 10. Do's and don'ts

- ✅ Give accounts clear, specific names — you'll pick them from dropdowns constantly.
- ✅ Put opening balances on the correct **Side** (use the §5 cheat-sheet).
- ✅ Use **Control type = Bank & Cash** for anything you receive/pay money through.
- ✅ Group logically (all banks together, all operating expenses together).
- ❌ Don't set a Control type on ordinary income/expense accounts — leave them **None**.
- ❌ Don't expect to change **Type** or **Control type** later — they're fixed at
  creation (delete + re-create if wrong).
- ❌ Don't be alarmed by brackets `( )` — that just means the balance is opposite to the
  account's normal side (e.g. an overdrawn bank, a supplier who's in credit).
