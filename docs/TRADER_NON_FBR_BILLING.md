# Optional non-FBR billing

`AllowNonFbrBills` defaults to false on every existing and new company. Only
the seed administrator may change it, through the company form and the existing
company update endpoint. Ordinary company edits that omit the field preserve it.
There is no startup activation by company name or id. Enable only the selected
company when releasing this feature; deployment and activation are separate steps.

Enabled companies retain FBR as the default treatment. Standalone and challan-based
bills additionally offer SRB (15% initially, editable between 0 and 100) and No tax
(0%). Saved treatment and rate survive reads and edits. Disabling the company
setting prevents new non-FBR bills without reclassifying old ones. Existing FBR
bills are not converted, and submitted bills remain locked.

SRB and No tax bills cannot be previewed, validated or submitted to FBR, including
direct API/MCP requests. The shared FBR service refuses them before provider calls.
They are excluded from the FBR tax sheet, tax-claim bank, and FBR dashboard counts.
The commercial sales report retains them with an Outside FBR status. No FBR stock
movements are created. Customer balances and ledger posting use the commercial
total, including freight; sales tax is calculated on goods/services only. SRB tax
posts to the existing output-tax liability account with an SRB description.

Print data exposes `taxTreatment` and `taxLabel` (GST / SRB sales tax / No tax).
Saved customer templates can use `{{taxLabel}}` beside `{{gstRate}}`; this change
does not rewrite existing customer designs or submit anything to SRB.

Local proof:
- `python scripts/test_trader_non_fbr_bills.py --base http://localhost:<port> --database <scratch_Test>`
- `npx vitest run src/Components/BillTaxTreatmentField.test.jsx`
- Verify both creation forms at 375, 768 and 1280 pixels; no horizontal overflow.

The migration adds only the company flag (false) and bill treatment (FBR).
Rollback requires preserving non-FBR bill classification before dropping columns;
do not downgrade a database containing SRB bills into FBR-only code.
