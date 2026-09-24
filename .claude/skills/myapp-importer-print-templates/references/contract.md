# Importer branch contract

Branch: `feat/importer-ledger-receipts`. Source revision inspected: `eef1dede497abb343d4cb915127b58fea80ecfa2`. No production write or live schema audit was performed to create this skill.

Templates may be division-scoped; inspect `usePrintTemplates.js` and resolve against the document's `divisionId`. Bill and tax output can group by item type depending on `PrintGroupBillByItemType` / `PrintGroupTaxInvoiceByItemType` and typed-row eligibility. Grouped quantity/rate semantics differ from individual rows. TaxInvoice has distinct company/supplier/division branding. This variant includes advance tax (`advanceTaxSection`, `advanceTaxRate`, `advanceTaxAmount`, `advanceTaxLabel`, `totalWithAdvanceTax`), withholding, further tax, and `collectible`. TaxInvoice also exposes explicit rounded totals and `amountInWordsRounded`; choose a consistent numeric/words pair from the service. Do not assume `grandTotal`, `totalWithAdvanceTax`, `balanceDueAfterWht`, and `collectible` are interchangeable or sum taxes again. Bill exposes FBR fields including `fbrInvoiceNumber`; it still lacks Trader's `printTemplateType` and bill-line tax aliases. TaxInvoice does not expose Trader's `billItems`. Frontend base is `/admin/`.

## Sources and rendering rules

Read `DTOs/PrintDtos.cs`, `Services/Implementations/InvoiceService.cs` (`GetPrintBillAsync`, `GetPrintTaxInvoiceAsync`), `myapp-frontend/src/utils/templateEngine.js`, `templateSampleData.js`, starter/default modules, and `myapp-frontend/src/hooks/usePrintTemplates.js` in this branch. For receipt/payment and other catalogs, trace the corresponding endpoint and DTO separately; appearance in the frontend catalog alone does not prove availability in live JSON.

Read-only bill/tax routes are `/api/invoices/{id}/print/bill` and `/api/invoices/{id}/print/tax-invoice`. Resolve IDs in the selected environment; do not reuse another tenant's IDs. Inspect `Controllers/PrintTemplatesController.cs` and `Controllers/StampsController.cs` for this branch's save and stamp contract.

Use supported `fmt`, `fmtDec`, and quantity helpers according to requested precision. `math` only supports addition/subtraction in the inspected renderer; do not compute division with it. Prefer supplied unit prices and tax totals. `richText` and `nl2br` implement escaped formatting; do not inject raw customer HTML.

Where FBR fields exist, guard the entire verification area with submitted status and nonempty IRN; an always-populated logo alone is not proof of submission. Use inline API QR/logo assets. Do not submit invoices or call external QR generators to test printing.

Inspect `stampSlot.js` and `usePrintTemplates.js` before promising explicit unsigned behavior: these variants still pass a company-default stamp fallback in the inspected source. Test no-stamp selection end to end. If that fallback defeats the requested unsigned version, propose a scoped implementation fix rather than assuming Trader's fix exists. Do not port the newer Trader stamp-position controls without confirming the target branch supports them.

Run this branch's required build/security/basic-flow/tenant checks for code changes. Keep mutation-based tests local. Existing saved templates are separate from built-in defaults; changing a catalog is not a migration of saved templates. Use the matching deploy workflow only when deployment is authorized.
