# Spreadsheet Import — setup and onboarding guide

How to take a new business's two Excel sheets — **opening stock** and the
**customer outstanding ledger** — and turn them into a working company in the
system: what to create, on which screen, and in what order.

Written for the person doing the onboarding. No accounting background assumed,
but the order matters, so work top to bottom.

> **Two routes are described.** Each data step shows the **Import** route (the
> Spreadsheet Import screens) and the **By hand** route. Use the importer for a
> real onboarding — the by-hand route is there for a handful of rows, and for
> understanding what the importer is actually doing.

---

## Before you start

Have these ready:

- The two workbooks, closed in Excel (a file open on your machine can still
  upload, but a file open in *someone else's* Excel may upload half-saved).
- The date the opening figures are "as at" — normally the first day of the new
  financial year, e.g. **1 July 2026**.
- The period the ledger covers, e.g. **July 2025 – June 2026**.
- Confirmation from the business owner that the closing balances in the sheet
  are the ones they actually agree with. Once imported, these become the
  customer balances everyone works from.

Give yourself 45–60 minutes for a first company. Most of it is Part 1.

---

## Part 1 — Create the company (one time)

Every step here is on the live site today.

### 1.1 Create the company

**Companies → New Company.**

Fill in the legal name, address, NTN and STRN exactly as they appear on the
business's letterhead — these print on every invoice.

Leave **FBR enabled** OFF for now. FBR submission is a separate decision, and
none of the import depends on it. You can turn it on later under
**FBR Settings** once the business has its token.

### 1.2 Give yourself access to it

**Tenant Access.**

A new company is invisible to everyone except the seed admin until someone is
granted it. Add yourself, and anyone else doing the onboarding.

> If a company you just created does not appear in the company picker, this is
> almost always the reason.

### 1.3 Set up the chart of accounts

**Chart of Accounts → Seed preset → Wholesale.**

This creates the standard account tree — Accounts receivable, Inventory, Sales,
Retained earnings and the rest. The import writes into these accounts, so it has
to exist first.

Do **not** hand-build a chart of accounts for an imported company. The preset's
accounts carry *control types* (the tag that tells the system "this one is
Accounts receivable"), and an account you create yourself has none, so the
import cannot find it.

### 1.4 Add the bank and cash accounts

**Bank & Cash Accounts.**

Add one row per real account the business uses — its cash box, and each bank
account. Receipts are recorded against these.

### 1.5 Check the units

**Units.**

Make sure every unit that appears in the stock sheet exists: Pcs, Kg, Ltr, and
so on. Add any that are missing.

You do not need to worry about capitals — `Kg`, `KG` and `kg` are treated as the
same unit. Add the one that reads best.

Where a unit can hold **fractions** (kilograms, litres, metres), tick *allow
decimal quantities* on that unit. A stock sheet that says `67.009 Kg` will be
rounded down to `67` otherwise.

### 1.6 Load the HS code master

**Item Types → Import HS Codes.**

This pulls Pakistan Customs' full tariff list into the system. It is shared
across every company — if another company already ran it, you can skip this.

You need it because the stock sheet classifies items by HS code, and the import
checks each code against this list. Pressing the button twice is safe; it adds
nothing the second time.

### 1.7 Decide how inventory is tracked

**Stock → Settings.**

For an importer/wholesaler bringing in opening stock, choose
**Standard (all item types)**. This treats every item as inventory.

Turning this on also switches on the **stock guard**, which stops someone
selling more of an item than is on hand. That is usually what you want, but tell
the team — it changes their day-to-day.

### 1.8 Give the right people permission

**Roles.** Under the **Accounting** section you will find **Spreadsheet Import**:

| Permission | Who needs it |
|---|---|
| Layouts – View | anyone running an import |
| Layouts – Manage | whoever describes a *new* workbook shape the first time |
| Opening Stock – Run | the person importing the stock sheet |
| Customer Ledger – Run | the person importing the ledger |
| History – View | anyone who needs to see what has been imported |
| History – Force Re-import | **senior staff only** — see Part 5 |

---

## Part 2 — The stock sheet

**What this sheet is:** every item the business is holding, with the quantity
left and what it is worth.

**Where it lands:** each item becomes an **Item Type**, and its quantity becomes
that item's **opening stock balance**. The total value becomes the opening
balance on the **Inventory** account.

### Route A — Import

1. **Accounting → Spreadsheet Import.** Choose the company, and choose
   **Opening Stock**.
2. **Upload the workbook.** The system checks it is a real Excel file and reads
   its shape.
3. **Check the layout.** Two layouts ship with the system — **Standard stock
   sheet** and **Standard customer ledger** — so a normal workbook is recognised
   and described before you touch anything.
   - Recognised: the columns are already right. Go to step 4.
   - Not recognised: the built-in is selected as a starting point and the sheet
     is shown with column numbers along the top. Correct anything wrong, name it,
     and press **Save layout** — that shape is then recognised on sight.
4. **Review.** Every row shows what will happen:

   | Says | Means |
   |---|---|
   | *Matched* | this item already exists — its quantity is updated, nothing new is created |
   | *Will create* | a new item type is added |
   | *Needs a choice* | the name matches an existing item but the HS code differs — pick which one is right |
   | *Unknown HS code* | that code is not in the tariff master — fix the sheet, or run step 1.6 |

5. **Set the "as at" date** — normally 1 July of the new year.
6. **Import.**

### Route B — By hand (works today)

For 50-odd items this takes about an hour.

1. **Item Types.** For each distinct item in the sheet, check whether it already
   exists. If not, create it: name from the **Items** column, plus its HS code
   and unit.
   - Ignore the **Sub Category** column entirely. It is the accountant's own
     grouping and has no home in the system.
   - If the same item appears on more than one row (two different GD lots), it
     is still **one** item type. Add the quantities together.
2. **Stock → Opening Balances.** For each item, enter the **closing quantity**
   from the sheet and the as-at date.
3. **Chart of Accounts → Inventory → Set opening balance.** Enter the sheet's
   **total closing value** as a debit.
   - The other side posts to Retained earnings automatically. You do not need to
     make a balancing entry, and you should not.

### What the sheet must contain

| Needed | Where it comes from |
|---|---|
| Item name | the **Items** column |
| HS code | the 8-digit column preferred, 4-digit accepted |
| Unit | Pcs, Kg, … |
| Closing quantity | the **Balance → Qty** column, *not* Opening |
| Closing value | the **Balance → Excl** column |

Ignored: sub-category, GD number and date, purchase price, tax columns, and the
cost-of-goods-sold block. Those are the accountant's working, not data the
system keeps.

---

## Part 3 — The customer ledger

**What this sheet is:** every customer, what they owed at the start of the year,
every invoice raised and payment received, and what they owe now.

**Where it lands:** each customer becomes a **Client**; each invoice line becomes
an **Invoice**; each payment becomes a **Receipt**. The **Customer Ledger**
screen then shows the same running balance the workbook does.

### Understanding the sheet's columns

This is the one thing worth getting straight before you start, because it reads
backwards from what an accountant expects:

- **Credit** = an invoice. It **increases** what the customer owes.
- **Debit** = money received. It **decreases** what they owe.
- **Balance** = Opening + Credit − Debit.

The system shows the customer ledger the same way round, so it will look
familiar. Behind the scenes the accounting entries are the conventional ones.

### Route A — Import

1. **Accounting → Spreadsheet Import.** Choose the company, and choose
   **Customer Ledger**.
2. **Upload the workbook** and check the layout, exactly as in Part 2. Then set
   the **period** the workbook covers — layouts carry no dates, so the same one
   keeps working every year.
3. **Check the customer list.** The index sheet names every customer and there is
   one sheet each. Where the two names differ slightly — *"Imperial Developers &
   Builders"* on the index and *"Imperial Developers And Builders (PVT) LTD"* on
   the sheet — you are asked to confirm the pairing. **Read these.** A wrong
   pairing puts one customer's invoices on another's account.
4. **Read the reconciliation panel.** This is the most important screen in the
   whole process. For every customer it shows:

   ```
   Customer                  From the sheet      Calculated      Difference
   Pakistan Hardware          7,178,505.86     7,178,505.83            0.03
   Elite Ventures            10,363,964.71    10,363,964.73            0.02
   ```

   Differences should be **paisa, not rupees**. Amounts are stored to two
   decimal places while these workbooks carry many more, so a customer with
   thirty documents can land a few paisa out — that is rounding, and it is
   expected. The importer allows one paisa per document and refuses anything
   larger.

   Then check the grand total against the index sheet's own total.

   If a difference runs to **rupees**, the import is refused outright. Go back to
   the sheet — a wrong opening balance quietly follows that customer through
   every statement from then on.

5. **Read the warnings.** They are not blocking, but each one is telling you
   something real. See the table below.
6. **Import.**

### Route B — By hand (works today)

Only sensible for a handful of customers. For 65, wait for the importer.

1. **Clients.** Create each customer from the index sheet. Use **Clients →
   Import** to bulk-create them from a simple CSV of names and addresses.
2. **For each customer with an opening balance:** create one invoice dated the
   day before the period starts (e.g. 30 June 2025) for the opening amount.
   Number it in a range well clear of the real invoices — 900001 upward — so it
   cannot collide.
3. **Enter each invoice** from the Credit column, using the sheet's own number
   (`AA-3` → invoice number `3`).
   - Where the same number appears on several rows of one customer's sheet, that
     is **one invoice** split over several lines. Add them together.
4. **Receipts.** For each Debit row, record a receipt against that customer.
   Leave it **on account** — do not try to guess which invoice it paid, because
   the sheet does not say.
5. **A customer whose opening balance is negative** (they had paid ahead) gets a
   **receipt** dated the day before the period starts, not an invoice.

### Warnings you should expect, and what they mean

| Warning | What it means | What to do |
|---|---|---|
| *Running balance disagrees with its own rows* | someone typed over a formula in the Balance column | Nothing. The rows are correct and are what gets imported |
| *Date is outside the period* | a typo, e.g. 2026 where 2025 was meant | Check it. A future-dated invoice will sit oddly in reports |
| *Invoice number appears twice* | one invoice written across several lines | Normally fine — they are added together. Confirm it is not two real invoices sharing a number |
| *Customer sheet name differs from the index* | a spelling variation | Confirm the pairing |
| *Row has no date* | common on cash receipts | The date of the row above is used. Check that reads sensibly |
| *Opening balance is negative* | the customer had paid in advance | Correct — it becomes a receipt, not an invoice |

### One thing to tell the business owner

The ledger records totals only — it does not break out sales tax. So imported
invoices carry **no tax split**, and the tax reports will show **zero output tax
for the imported period**.

This is correct for a year that is already filed and closed: the real tax
position lives in the opening balances. But it surprises people who open the tax
report expecting last year's figures, so say it up front.

---

### What a real import looks like

For reference, the client's own 66-sheet workbook imports as:

| | |
|---|---|
| Customers | 65 |
| Invoices | 647 (598 from the sheets, 49 opening balances) |
| Receipts | 166 (165 from the sheets, 1 negative opening) |
| Opening total | 78,094,026.22 |
| Closing total | 234,434,673.96 |
| Customers out of balance | 0 |

---

## Part 4 — Check it worked

Do all four. They take five minutes and catch almost everything.

1. **Customer Ledger** — pick three customers, one large, one small, one with a
   negative balance. Each closing balance must equal the workbook's.
2. **Accounting → Reports → Trial Balance** — must balance. Accounts receivable
   should equal the total of every customer's closing balance.
3. **Stock → On Hand** — spot-check three items against the stock sheet.
4. **Reports → Client Ledger** — the company-wide total must equal the index
   sheet's closing total.

If any of these disagree, do not start entering live transactions. Fix it now —
see Part 5.

---

## Part 5 — Fixing mistakes

### "I imported the same file twice"

You cannot. The system refuses a file it has already imported into that company,
and tells you when it was imported and by whom. Nothing is written.

This also holds for a file that has been re-saved or re-exported: even though it
is a different file, the system recognises that every row is already there and
refuses it.

### "The file has new rows since last time"

That is fine and expected. Import it again — the rows already present are
skipped and listed, and only the new ones are added.

### "I imported the wrong file / the mapping was wrong"

You need **History – Force Re-import**, which is deliberately restricted.

1. **Accounting → Spreadsheet Import → History.**
2. Find the run and choose **Set aside**, giving a reason. The reason is kept on
   the record.
3. Import the corrected file.

Setting a run aside does not delete what it wrote. Anything created in error has
to be removed on its own screen. **Ask before doing this on a company that has
been live for a while** — by then real transactions may be sitting on top of the
imported ones.

### "The mapping was nearly right"

Do not create a second layout. **Spreadsheet Import → Layouts**, open it, fix the
columns and save. Every change is versioned, and you can roll back to any earlier
version — so an edit that turns out wrong is one click to undo.

The two built-in layouts cannot be deleted — save your own copy instead, which is
then used ahead of the built-in for your company.

### "Will next year's file need mapping again?"

No. Layouts are matched on the **headings**, not the contents, so next period's
workbook is recognised even though every product, customer, amount and date in it
has changed. It also carries no dates of its own — you set the period on each
import.

---

## Part 6 — Preparing the workbook

Most import problems are file problems. Worth a check before you upload.

**Will be rejected outright**

- Anything that is not `.xls`, `.xlsx` or `.xlsm`
- A file renamed to look like Excel (a PDF saved as `.xlsx`)
- A `.xls` renamed to `.xlsx`, or the reverse
- Password-protected or corrupt files
- Empty workbooks
- Anything over 10 MB

**Fix in Excel first**

- **Merged cells in the data rows.** Merge across a heading if you like, never
  across the numbers.
- **Numbers stored as text** — the little green triangle. Select the column and
  convert to number.
- **Blank rows in the middle** of a customer's transactions.
- **A stray total row** in the middle rather than at the bottom.

**Leave alone — the system handles it**

- Formulas (the calculated value is read, not the formula)
- Extra columns you do not use
- Mixed capitals in item and unit names
- A hand-typed Balance column that no longer adds up
- Trailing spaces

---

## Quick reference — what goes where

| From the sheet | Becomes | Screen |
|---|---|---|
| Item name + HS code | Item Type | Item Types |
| Closing quantity | Opening stock balance | Stock → Opening Balances |
| Total stock value | Inventory opening balance | Chart of Accounts |
| Customer name | Client | Clients |
| Opening balance (positive) | Invoice dated day before the period | Bills |
| Opening balance (negative) | Receipt dated day before the period | Receipts |
| Credit row | Invoice | Bills |
| Debit row | Receipt, on account | Receipts |
| Closing balance | *nothing* — calculated, never entered | Customer Ledger |

That last row is the one people get wrong. **Never type a closing balance in.**
It is worked out from the invoices and receipts, and entering it as well doubles
the customer's debt.
