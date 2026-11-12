---
name: trader-hs-sheet-classify
description: Use on the TraderFbrInvoicingSystem line when someone hands over a consultant's workbook that gives an HS code per invoice line and asks to "adjust", "classify" or "put HS codes on" a company's invoices/bills — local or production, through the signed-in browser or the hosted MCP. Reads any workbook layout, matches each row to its bill line, plans the FBR filing rows (one per HS code per bill), and saves them with the Invoices screen's own tax-filing save. Never submits to FBR.
---

# Classify Trader bills from an HS-code workbook

Each consultant keeps their own workbook; the layout changes, the concept does not: every
row says *invoice N, this line, this HS code*. The job is to turn that into each bill's
**tax filing rows** (what FBR is sent). Scripts do the work; you run them and relay short
summaries. Do not read the workbook or the JSON into the conversation.

## What classifying does — and does not

- Saves `PUT /api/invoices/{id}/tax-filing` (MCP: `prepare_bill_tax_filing` + `commit_action`):
  the same server path and checks as the Invoices screen (same tax, valid unit, no duplicate
  FBR items, bill unchanged since read). The commercial bill, its print lines, **stock and the
  GL are not changed**, and nothing is validated or submitted to FBR — say so if the user
  expects stock to move.
- Lines sharing an HS code on one bill become ONE filing row (quantity and value summed). That
  matches how consultants classify by hand and avoids FBR's "duplicate item" refusal.
- Skipped automatically: bills already classified (unless `overwrite`), filed/submitted or
  cancelled bills, invoices not found, and any invoice with a blank HS cell.

## Steps

1. **Read the workbook** (≈0 tokens of data in context):
   `python .claude/skills/trader-hs-sheet-classify/scripts/sheet_to_rows.py "<book.xlsx>" --out <scratchpad>/rows.json`
   Check the printed mapping + 3 sample rows. Wrong column? re-run with `--sheet`, `--inv-col`,
   `--hs-col`, `--desc-col`, `--amount-col` (letter, number or heading). Needs an invoice and an
   HS column plus a description and/or amount column. The last number in the invoice cell is the
   bill number. If the workbook names a different company's numbering, stop and ask.
2. **Pick the company** (its id, e.g. from `GET /api/companies` in the browser) and confirm it with the user.
3. **Plan** — one call, returns a summary only:
   - Browser (user signed in on the site, app tab open): `Read` `scripts/classify_browser.js`
     once and run it with `javascript_tool`, then
     `await HSC.plan({ companyId, rows: <contents of rows.json> })`.
     Large sheets cost tokens to inline — prefer MCP for hundreds of rows.
   - MCP (token in env `MYAPP_MCP_TOKEN`, scopes read + taxfiling.write [+ itemtypes.write]):
     `python .claude/skills/trader-hs-sheet-classify/scripts/classify_mcp.py --base <site> --company <id> --rows <rows.json>`
4. **Resolve before saving** — the plan lists each HS code with its catalog item and unit:
   - `PROBLEM` lines (a sheet row with no bill line, or a bill line not in the sheet): never
     guess; show them and leave those bills out, or ask.
   - `NEW:` codes have no catalog item; one is created on the first save. Ask the user for its
     **name** and, when FBR offers several, the **unit** (default KG). Browser: `names`/`units`
     options; MCP: `--name 7217.1000="..."` `--unit 7217.1000=KG`.
   - "+N other items share this code": confirm which item; pass `items: {hs: id}` / `--item hs=id`.
5. **Get the user's go-ahead in chat** (production writes to a live company) with: bills, lines,
   filing rows, per-code item/unit, what is skipped, and that stock/FBR are untouched.
6. **Apply**: do ONE bill first (`HSC.apply({ only: [n] })` / `--apply --only n`), check it,
   then the rest (`HSC.apply()` / `--apply`). Both stop at the first refusal and report it —
   fix the cause, re-plan, and continue (already-saved bills are skipped on re-plan).
7. **Verify**: `await HSC.verify()` (every planned bill saved, FBR-ready, each line under the
   sheet's HS code, rows sum to the subtotal). MCP: re-run without `--apply`; saved bills now
   show as `skipped classified`.
8. Report: counts, new items (id, name, HS, unit), what was skipped, and that FBR validation/
   submission is still the user's step.

## Rules

- Production is the user's data: only after their explicit go-ahead in chat, in their signed-in
  session or with their MCP token. Never read the token into the conversation, never use SQL.
- Never change quantities or amounts from the workbook — they come from the bill lines.
- Proven on a live 55-bill run (2026-11-12) and on local test companies through both routes;
  the reader handles other layouts (headings on any of the top 15 rows, "Bill No"/"PCT Code"/
  "Particulars", HS as 84811000). A NEW HS code needs a working FBR token: the server checks the
  code with FBR before creating its item, so that path cannot be exercised with a test token.
