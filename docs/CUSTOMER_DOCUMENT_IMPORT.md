# Customer document import

The quotation, sales order and delivery challan screens share one review flow.
Choose the company and customer before uploading. A quotation imports an enquiry
or demand; an order or challan imports a customer PO.

- PDF, image/OCR and pasted-text extraction retain their existing rules.
  Matching is constrained to the selected company and customer.
- Excel `.xlsx` files provide worksheet, header-row and column selection.
  Description and quantity are required; unit, price, item code and remarks
  are optional. The first 30 populated rows are available for header selection.
- Review the extracted lines before creating the document. Invalid source rows
  produce warnings with their source row numbers and require acknowledgement.
  Prices can remain zero for later quotation pricing; GST is explicitly editable.
  Source codes and remarks are retained in editable document notes.
- Save a named Excel layout from review for reuse by that company's customer.
  Multiple differently named layouts are allowed. Saved headers are checked on
  reuse; a changed layout must be mapped again. Save the revised layout with a
  different name and deactivate the old one when it is no longer needed.
- PDF onboarding can open from an unmatched import without losing its extracted
  text. Existing advanced rules can have their metadata edited without being
  replaced by the simple PDF editor.
- Uploaded files are archived and attached to the created document. Reusing a
  file for the same destination produces a duplicate warning; quotation and
  order imports are treated separately. This is a warning, not an idempotency
  guarantee. If document creation times out, check the document list before retrying.
- Customer Document Formats shows archived source downloads to users with the
  existing archive permission. File access and document attachment enforce the
  owning company. Production sample files and credentials stay outside Git.

The migration preserves existing formats and versions, replaces the one-format
index with a unique name per company/customer, and adds nullable document-link
fields to import archives. It requires a schema update before deploying the API.
Downgrading the format cardinality can lose layouts, so rollback requires the
pre-upgrade database backup rather than a destructive down migration.

## Verification

Run these from the repository root unless stated otherwise:

- `dotnet run -c Release --project scripts/customer_document_import_harness`
- `python scripts/test_customer_document_import.py --base http://127.0.0.1:5155`
  (localhost only; creates and removes an isolated fixture company; optional
  `LOCAL_TEST_USER` and `LOCAL_TEST_PASSWORD` environment variables)
- `dotnet run -c ImportAccess --project scripts/customer_format_access_harness`
  (creates and deletes its own uniquely named local test database)
- `dotnet run -c Release --project scripts/po_parser_harness`
- In `myapp-frontend`: `npx vitest run src/pages/POFormatsPage.test.jsx`
- `python scripts/test_basic_flows.py --base http://127.0.0.1:5155`
- `python scripts/verify_tenant_scope.py`
- `python scripts/verify_no_production_identifiers.py`

The private replay harness accepts a directory containing downloaded `formats.json`,
`archives.json` and the original files named by archive ID, plus a local SQL
connection. It never writes to that database. The verification run downloaded
250 production files read-only; 236 historically successful PDFs replayed without
changed extraction or reduced line counts. Eight formats had historical examples;
three had only header/row smoke coverage. All 11 active format definitions matched
the restored local copy. Previously failed and image imports are reported separately.

Keep the feature branch until review and merge into the Trader production line.
Only then remove the merged feature branch locally and remotely, after verifying
that it contains no commits absent from the merged target.

## Pasted emails

Paste the email table including headings, or a numbered item list. Clipboard
tables retain blank cells; plain-text vertical tables are also recognised.
Description, quantity and unit are extracted without confusing dimensions with
quantities. Missing quantities are left at zero and must be entered before
creation. Prices remain pending when absent. Sender references and row remarks
are retained in document notes. Review warnings are mandatory: signatures and
quoted tables are excluded, and incomplete or ambiguous rows require checking
against the original. This parser uses local rules and sends no email content to
an external AI service. It does not promise to understand every email layout.

Three private sample emails replayed with 14, 5 and 9 items respectively; the
source emails are excluded from Git. Clipboard tests run with
`npx vitest run src/utils/emailClipboardText.test.js`.
