# Trader branch contract

Branch: `TraderFbrInvoicingSystem`. Source revision inspected: `8e1d8d5ad251ea7d63288dc1748a96f81f5b94df`. No production write or live schema audit was performed to create this skill.

# Trader print profile

Scope: `TraderFbrInvoicingSystem` only. Re-check the current source and live print DTO before relying on this profile; code and deployments may differ. The established matching eight-column layout is a Trader example, not a mandatory design for every future user or other production branch.

## Implementation map

Paths below are relative to the MyApp.Api checkout:

| Concern | Source |
| --- | --- |
| Print contracts | `DTOs/PrintDtos.cs` |
| Bill vs adjusted invoice projection | `Services/Implementations/InvoiceService.cs`: `GetPrintBillAsync`, `GetPrintTaxInvoiceAsync` |
| Render helpers and merge-field catalog | `myapp-frontend/src/utils/templateEngine.js` |
| Shared eight-column layout | `myapp-frontend/src/utils/invoiceDocumentTemplate.js` |
| Built-in defaults and previews | `myapp-frontend/src/utils/defaultTemplates.js`, `templateSampleData.js` |
| Invoice starters | `myapp-frontend/src/utils/starters/bill.js`, `taxInvoice.js` |
| Saved Bill FBR insertion | `myapp-frontend/src/utils/billFbrSection.js` |
| Stamp resolution and placement | `myapp-frontend/src/utils/stampSlot.js`, `stampPlacement.js`, `myapp-frontend/src/hooks/usePrintTemplates.js` |
| Editor and draggable stamp block | `myapp-frontend/src/pages/TemplateEditorPage.jsx`, `myapp-frontend/src/utils/grapesConfig.js` |
| Saved-template API | `Controllers/PrintTemplatesController.cs` |
| Company stamp upload/selection | `Controllers/StampsController.cs` |

Read-only invoice routes: `/api/invoices/{id}/print/bill` and `/api/invoices/{id}/print/tax-invoice`. Template discovery: `/api/printtemplates/company/{companyId}` and `/api/printtemplates/{id}`. Determine IDs from the target environment; never reuse a prior tenant's IDs.

## Merge semantics

These are JSON/Handlebars keys, not C# property casing. Confirm the current response.

| Data | Bill | Sales tax invoice |
| --- | --- | --- |
| Issuer | `companyBrandName`, `companyLogoPath`, `companyAddress`, `companyPhone`, `companyNTN`, `companySTRN` | Same company aliases; DTO also exposes supplier fields |
| Recipient | `clientName`, `clientAddress`, `clientPhone`, `clientNTN`, `clientSTRN` | `buyerName`, `buyerAddress`, `buyerPhone`, `buyerNTN`, `buyerSTRN` |
| Header/totals | `invoiceNumber`, `date`, `poNumber`, `subtotal`, `gstRate`, `gstAmount`, `grandTotal`, `amountInWords` | Same keys |
| Default row source | `items`: original commercial bill rows | `items`: effective/adjusted filing rows grouped by item type |
| Quantity/rate | `this.quantity`, `this.unitPrice`: originals | Same keys: adjusted values supplied by the API |
| Description | `this.description` | Conditional `this.hsCode` plus `this.itemTypeName`, with `this.description` fallback when needed |
| Row amounts | `this.lineTotal`, `this.valueExclTax`, `this.gstRate`, `this.gstAmount`, `this.totalInclTax` | `this.valueExclTax`, `this.gstRate`, `this.gstAmount`, `this.totalInclTax` |
| Unit | `this.uom` | `this.uom` |

Some revisions also expose `billItems` on the tax-invoice DTO for a deliberately commercial, unadjusted view. Verify its presence and grouping semantics in the target deployment. Do not substitute it for `items` when the user requires adjusted filing quantities/rates; do not assume it exists in other variants.

The established Trader reference uses S.No., Description, Quantity/UOM, Unit Price, Value Excluding Tax, GST %, Sales Tax Amount, and Value Including Tax. Its bill and tax-invoice page geometry matches, with supplier/buyer boxes, totals, amount in words, and Prepared By / Verified By / Received By footer. Future user references may choose different geometry.

Use `{{fmt amount}}` for whole-rupee display when requested; `fmtDec` displays two decimals. Preserve fractional quantities: raw `quantity` preserves the provided value, while current `fmtQty` formats up to three decimal places. Do not round quantities as money or change stored numeric data to achieve display rounding. Print `this.unitPrice` directly: the current `math` helper supports only addition and subtraction, not division. Use `richText` and `nl2br` for their supported escaped content rather than unrestricted raw customer HTML.

## FBR and signatures

FBR merge fields: `fbrStatus`, `fbrIRN`, `fbrSubmittedAt`, `fbrQrPngDataUrl`, `fbrLogoUrl`. Render the entire verification section only inside:

```handlebars
{{#if (eq fbrStatus "Submitted")}}{{#if fbrIRN}}
  <!-- IRN and optional inline QR/logo images -->
{{/if}}{{/if}}
```

Use the API's inline QR and logo values. A logo value may exist even on an unsubmitted tax DTO, so testing only logo presence is insufficient. Do not use a remote QR-generation service or submit to FBR for previewing. The renderer adds FBR support to older saved Bill layouts using `printTemplateType: "Bill"`; check that custom layouts do not receive duplicate sections.

Use `slotMarkup()` or the supported stamp slot, then `withStamp`/`materializeStamp` before merging. Assigned stamps must survive the renderer's second resolution pass. No assignment means no image even with a company default. Explicit `{{stamps.slug}}` references are pinned stamps; convert to the assigned slot when the user wants picker-driven signed/unsigned versions. Avoid enclosing the label itself in a condition that hides it when unsigned.

`positionStamp` finds signature labels without reserializing the entire HTML. Browser DOM parsing can move Handlebars table loops outside the table; use the existing visual-editor codec if editing visual state. Verify after save/reload that item loops, selected stamp, and placement remain intact.

## Verification commands

Run relevant checks from the checkout, in addition to current `AGENTS.md` pre-push requirements:

```text
node myapp-frontend/scripts/test-bill-fbr.mjs
node myapp-frontend/scripts/test-print-stamps.mjs
dotnet run --project scripts/print_dto_checks/print_dto_checks.csproj
```

For DTO/service edits run backend build and local basic-flow/tenant checks; do not point mutation-based tests at production. Frontend builds for Trader use `VITE_BASE_PATH=/admin/`. The production workflow is `.github/workflows/deploy-trader.yml`; verify its run and live API readiness before applying saved templates that need new fields. Built-in defaults are supplied by the frontend; seeding defaults deliberately leaves existing saved document types unchanged.
