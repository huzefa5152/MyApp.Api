# Master branch contract

Branch: `master`. Source revision inspected: `14ea451942333384519db9b14054da78d836e10a`. No production write or live schema audit was performed to create this skill.

Bill `items` carry original commercial quantities, rates and line totals. Sales-tax `items` use the tax projection; inspect adjustment/grouping logic before matching the requested presentation. Bill DTO lacks `printTemplateType`, FBR fields, `clientPhone`, and per-row `valueExclTax`/GST aliases present in Trader. Do not use those Trader tokens without a separately implemented and deployed change. TaxInvoice has FBR fields and company/supplier branding aliases; it does not expose Trader's `billItems` alternate collection. Root frontend base is `/`.

## Sources and rendering rules

Read `DTOs/PrintDtos.cs`, `Services/Implementations/InvoiceService.cs` (`GetPrintBillAsync`, `GetPrintTaxInvoiceAsync`), `myapp-frontend/src/utils/templateEngine.js`, `templateSampleData.js`, starter/default modules, and `myapp-frontend/src/hooks/usePrintTemplates.js` in this branch. For receipt/payment and other catalogs, trace the corresponding endpoint and DTO separately; appearance in the frontend catalog alone does not prove availability in live JSON.

Read-only bill/tax routes are `/api/invoices/{id}/print/bill` and `/api/invoices/{id}/print/tax-invoice`. Resolve IDs in the selected environment; do not reuse another tenant's IDs. Inspect `Controllers/PrintTemplatesController.cs` and `Controllers/StampsController.cs` for this branch's save and stamp contract.

Use supported `fmt`, `fmtDec`, and quantity helpers according to requested precision. `math` only supports addition/subtraction in the inspected renderer; do not compute division with it. Prefer supplied unit prices and tax totals. `richText` and `nl2br` implement escaped formatting; do not inject raw customer HTML.

Where FBR fields exist, guard the entire verification area with submitted status and nonempty IRN; an always-populated logo alone is not proof of submission. Use inline API QR/logo assets. Do not submit invoices or call external QR generators to test printing.

Inspect `stampSlot.js` and `usePrintTemplates.js` before promising explicit unsigned behavior: these variants still pass a company-default stamp fallback in the inspected source. Test no-stamp selection end to end. If that fallback defeats the requested unsigned version, propose a scoped implementation fix rather than assuming Trader's fix exists. Do not port the newer Trader stamp-position controls without confirming the target branch supports them.

Run this branch's required build/security/basic-flow/tenant checks for code changes. Keep mutation-based tests local. Existing saved templates are separate from built-in defaults; changing a catalog is not a migration of saved templates. Use the matching deploy workflow only when deployment is authorized.

## A field the editor does not list does not exist

The print DTOs and the editor's merge-field sidebar are two separate lists. The
sidebar reads `myapp-frontend/src/utils/templateEngine.js`, keyed by document
type. Adding a property to a `Print*Dto` does not add it there.

On the Trader line `PrintTaxItemDto.HSCode` shipped and rendered correctly for
months while no document type listed it — usable only by someone who already
knew the token. Check this variant's own `templateEngine.js` rather than
assuming: a DTO field addition is finished only when it also appears there under
every document type that serves it, with an operator-readable label, and in
`templateSampleData.js` so the Preview shows it.
