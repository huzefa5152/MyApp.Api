# Customize branch contract

Branch: `customize-solution-for-other`. Source revision inspected: `f92e834185ac263e23b7c271a9d2905bf0cacaec`. No production write or live schema audit was performed to create this skill.

Templates and print documents may be scoped by division as well as company. Inspect `usePrintTemplates.js` resolution order and the document's `divisionId`; do not replace a different division's default. TaxInvoice exposes company, supplier, and division branding separately. Bill and TaxInvoice include `withholdingTaxRate`, `withholdingTaxAmount`, and `balanceDueAfterWht`; use the service's values, not calculations invented in HTML. `PrintGroupBillByItemType` and `PrintGroupTaxInvoiceByItemType` can change row grouping when all rows are typed. Grouped bill description is the item type, and unit price is derived from grouped amount/quantity, so do not describe all returned rows as original individual lines. Bill lacks Trader's FBR and per-line tax aliases. TaxInvoice has FBR fields but no Trader `billItems`. Frontend base is `/admin/`.

## Sources and rendering rules

Read `DTOs/PrintDtos.cs`, `Services/Implementations/InvoiceService.cs` (`GetPrintBillAsync`, `GetPrintTaxInvoiceAsync`), `myapp-frontend/src/utils/templateEngine.js`, `templateSampleData.js`, starter/default modules, and `myapp-frontend/src/hooks/usePrintTemplates.js` in this branch. For receipt/payment and other catalogs, trace the corresponding endpoint and DTO separately; appearance in the frontend catalog alone does not prove availability in live JSON.

Read-only bill/tax routes are `/api/invoices/{id}/print/bill` and `/api/invoices/{id}/print/tax-invoice`. Resolve IDs in the selected environment; do not reuse another tenant's IDs. Inspect `Controllers/PrintTemplatesController.cs` and `Controllers/StampsController.cs` for this branch's save and stamp contract.

Use supported `fmt`, `fmtDec`, and quantity helpers according to requested precision. `math` only supports addition/subtraction in the inspected renderer; do not compute division with it. Prefer supplied unit prices and tax totals. `richText` and `nl2br` implement escaped formatting; do not inject raw customer HTML.

Where FBR fields exist, guard the entire verification area with submitted status and nonempty IRN; an always-populated logo alone is not proof of submission. Use inline API QR/logo assets. Do not submit invoices or call external QR generators to test printing.

Inspect `stampSlot.js` and `usePrintTemplates.js` before promising explicit unsigned behavior: these variants still pass a company-default stamp fallback in the inspected source. Test no-stamp selection end to end. If that fallback defeats the requested unsigned version, propose a scoped implementation fix rather than assuming Trader's fix exists. Do not port the newer Trader stamp-position controls without confirming the target branch supports them.

Run this branch's required build/security/basic-flow/tenant checks for code changes. Keep mutation-based tests local. Existing saved templates are separate from built-in defaults; changing a catalog is not a migration of saved templates. Use the matching deploy workflow only when deployment is authorized.
