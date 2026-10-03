# Trader MCP expansion proposal

Prepared 2026-10-03 from the TraderFbrInvoicingSystem checkout. The proposal below records the original baseline; implementation progress is listed separately here.

## Implementation progress

The first local batch expands the potential catalogue from 19 to 44 tools: compact access and
action status, scoped print-template content and document print data, onboarding schema and
readiness, daily queues, sales/purchase lookups, and accounting reports. Discovery and direct
calls use current permissions, token scopes and company assignments. Print publication,
bulk onboarding writes and additional operational writes remain later phases.

MCP settings now live in Profile: Catalog Access, Connections and seed-only Administration.
The per-user catalog stores administrator grants and narrowing user choices, with revision
checks for concurrent edits. Normal user and role dialogs omit MCP settings while retaining
legacy grants. Existing credentials gain no new explicit print scopes automatically.

These changes require an additive profile-policy migration and local verification before any
production release. This progress entry does not claim production deployment or demo testing.

## Recommendation

Build three useful workflows first: revise a tenant's print design with a visual approval, onboard a new business from its existing files, and answer a daily operations question with actionable document links. Extend the existing hosted MCP and business services rather than create a second ERP through generic database tools.

The company rule applies to every proposed tool:

- Staff and tenant administrators: current UserCompanies assignments intersected with the token's company allow-list, plus the matching permission and product edition.
- Seed admin: every existing company only when its token permits All companies; an explicitly restricted seed-admin token remains restricted.
- All companies is an authorization capability, not a write destination. Every ordinary write names one company. Any deliberately supported batch lists each company and its changes for approval.
- Being assigned the Administrator role does not make an account the seed admin. Use the configured seed-admin identity, as the application already does.

## Inspection coverage and existing foundation

Reviewed the application-wide controller endpoint inventory and page/service inventory, then examined MCP dispatch/authentication/scopes/plans, company access and administration, edition rules, onboarding schema and import service, template management/repository/rendering, PO/challan import, and sales/purchase/accounting service contracts. Reviewed the repository's environment and MCP design instructions. This does not claim every implementation method was audited or that live functional tests passed.

| Area | Existing application capability | MCP today / opportunity |
| --- | --- | --- |
| Identity and tenants | Users, roles, editions, company grants, sessions, seed-admin management hierarchy | MCP tokens narrow user access; all-company marker is seed-admin only. Add capability discovery and safe provisioning plans. |
| Company setup | Company details, logo, numbering, inventory settings, ledger configuration | list_companies exposes IDs/names. Add readiness checks and a deliberately narrow seed-admin onboarding workflow. |
| Print documents | Named templates, defaults, HTML and visual editor project, Excel attachments, sheet pins, stamps, starters, merge fields | No print-template MCP tools. Highest immediate support value. |
| Master data/import | Customers, suppliers, items, units; workbook sample/preview/commit/fix list | prepare_client exists. Missing supplier/item tools and batch onboarding. |
| Sales | Quotations, sales orders, challans, bills, quote-to-order and order-to-challan flows | Quote/challan/bill preparation exists. Missing order reads/conversion and an operational work queue. |
| Purchase and stock | Purchase bills, goods receipts, opening stock, movement ledger, FBR purchase imports | get_stock gives quantity only. Missing purchase/receipt reads and source-aware stock explanations. |
| Collections | Receipts, payments, allocations, cheque lifecycle, withholding receipts | Outstanding/receivables reads exist. Missing receipt preparation and allocation assistance. |
| Accounting | Chart, journals, ledger, trial balance, P&L, balance sheet, ageing, cash book, tax control | Reports mostly not exposed. Reuse accounting report services; do not calculate balances in the LLM. |
| FBR | Local readiness, payload preview, submission/validation, monitor, reference catalogs | Search/status and tax-sheet reads exist. Offer local diagnostics first; submission remains outside this proposal. |
| Files and support | Attachments/folders, PO formats/parser/archive/feedback, customer portals, audit/MCP activity | Add scoped file intake, support diagnostics, and reviewed document exports. |

Current MCP catalogue has 19 possible tools: 13 reads and 6 plan/write tools. The write tools are prepare_client, prepare_quote, prepare_challan, prepare_bill, commit_action, cancel_action; visibility depends on token scopes. Existing reports include sales_summary, outstanding_ledger, receivables_by_client, tax_sheet_summary, item_rate_history.

## Priority 1: print-template support

Typical request: "For this company's challan, move the receiver signature right, add the PO date, and keep the existing letterhead. Show me the result before replacing it."

| Proposed tool | Purpose | Access |
| --- | --- | --- |
| list_print_templates(companyId, documentType) | IDs, names, default, editor mode, stamp state, Excel state, revision; omit large bodies | Own companies; print-template view |
| get_print_template(companyId, templateId) | Exact template body/project and metadata for one design, fetched in bounded sections if necessary | Own companies; print-template view |
| get_print_contract(documentType) | Supported merge fields, helpers, repeating items, assets, semantic checks and sample scenarios | Template permission; no tenant data |
| get_document_print_data(companyId, documentType, documentId) | The document service's actual print DTO | Own companies; the document's print permission |
| prepare_print_template_change(companyId, templateId, baseRevision, candidateRef) | Validate a draft, return before/after summary, changed fields and render results | Own companies; proposed templates.write scope plus existing update permission |
| preview_print_template(companyId, draftId, sampleCase, documentId?) | Before/after A4 preview and PDF with page count and layout diagnostics | Draft ownership; real data additionally needs document print permission |
| prepare_print_template_default(companyId, templateId, baseRevision) | Explicitly choose the printing default; do not hide this inside a content edit | Same company and update permission |
| list_print_template_versions / prepare_print_template_restore | Inspect and restore a known earlier revision through approval | New version storage required; same company/permission |

Commit the approved template plan through commit_action. Draft creation changes draft storage only; it never changes a live template or its default. For an existing type, offer Save as a new design as well as Update this design. Do not silently discard alternatives, Excel files, sheet pins, stamp assignments, or visual-editor project state.

A template edit must not change quantities, tax rates, invoice numbering, FBR status, or the commercial-versus-tax print DTO contract. Presentation edits cannot recalculate accounting figures. Changing which existing field is printed must be described explicitly; never substitute the bill's commercial quantity with the adjusted tax quantity as a styling side effect.

Validation needs more than valid HTML:

- Parse Handlebars blocks/helpers/field references against the document contract. Required information is defined by document semantics, not an exact number of table columns.
- Render 1-line and many-line samples, long descriptions/addresses, missing optional data, grouped/ungrouped tax invoices, stamps on/off, and submitted/unsubmitted examples where applicable.
- Detect unresolved placeholders, NaN, missing totals, broken assets, clipped content, split signature/totals blocks and unexpected page count. Visual inspection remains necessary where automatic measurements are inconclusive.
- Make the preview use templateEngine.mergeTemplate, stamp resolution, Bill FBR augmentation, rich-text handling and printDocument's print CSS. Build a protected render path around the existing renderer; do not invent a separate approximation in C#.
- Pass company assets explicitly for background rendering; do not rely on the browser's globally active stamp dictionary.
- Render drafts without script execution or unapproved external fetches. Preserve supported local assets and review asset changes rather than silently breaking existing designs.
- Record an immutable before/after version, content hash, target company/template, author and approval evidence. Check the base revision atomically at publish; a concurrent editor change requires a new preview.
- HTML-only editing of a visual project can leave two competing layouts. Start with code-mode templates, or support a project-aware update; any conversion of editor mode must be explicit and previewed.

The application has 12 template types: Challan, Bill, TaxInvoice, SalesQuote, SalesOrder, PurchaseBill, GoodsReceipt, DebitNote, CreditNote, Receipt, Payment, WithholdingTaxReceipt. Start with Challan, Bill and TaxInvoice, then extend the shared machinery.

Reusable designs for new businesses should be neutral starter designs with merge fields. Never copy another tenant's literal business/contact/tax data, bank details, logo, stamp or Excel attachment by default. Seed-admin cross-company copying must show the source, target and exactly which assets/data travel.

## Priority 2: onboarding from existing business records

Typical request: "Set up this new trading business from its customer spreadsheet, supplier list, item list and opening-stock workbook. Show the missing information and duplicates first."

| Proposed tool | Purpose | Access |
| --- | --- | --- |
| get_company_onboarding_status(companyId) | Missing setup, counts, print defaults, inventory status, ledger status, explicit readiness blockers | Own companies; field-level permissions; secrets never returned |
| get_onboarding_schema(companyId, sheets) | Derive allowed sheets, headings, required/conditional fields and accepted reference values from OnboardingSchema | Own companies; onboarding and relevant sheet permissions |
| prepare_onboarding_import(companyId, uploadId, mapping) | Validate a staged, normalized workbook with the existing import engine; counts, duplicate candidates, row issues and exact mapping | Proposed onboarding.write scope; all corresponding create permissions |
| get_onboarding_rows(batchId, status, cursor) | Bounded rows needing correction, with original source row/cell provenance | Batch owner and company access |
| get_import_result(batchId) / get_import_fix_list(batchId) | Counts, created record references, failed/skipped rows, secure corrective workbook | Batch owner and company access |
| search_suppliers / search_item_types / get_client_details | Resolve existing parties/items before creation, and retrieve only permitted fields | Own companies and matching view/picker permissions |
| prepare_supplier / prepare_item_type | Small interactive additions through the existing service validations | Own companies; separate supplier/item write scopes |

For the seed admin, add prepare_company_onboarding as a separate privileged scope. Its first plan should cover company name/branding, chosen document starters and confirmed business defaults; it should not accept FBR secrets. The user-provisioning step below is a separately reviewed security operation.

LLM-assisted intake is a translation layer, not a second validation engine. Extract from tenant-supplied spreadsheets, PDFs, images or pasted text; preserve source rows, identifiers as strings, and uncertain values as unresolved questions. Do not invent NTN/CNIC/HS codes, registration status, provinces or opening quantities. Ambiguous matches return candidates rather than silently joining records.

The existing canonical workbook covers Customers, Items, Suppliers and Opening Stock. It does NOT import historical sales/purchases, customer/supplier financial opening balances, a stock valuation, or a general-ledger opening journal. Treat those as separate future workflows with balancing and cutover-date validation; do not promise that today's opening-stock upload migrates the books.

Keep existing rows skipped and unchanged, as the current importer does. A duplicate update is a separate explicit change plan. Import in the service's dependency order. Reuse its per-row outcomes; it can keep successful rows if another row fails, so return partial completion honestly and make resumes idempotent. Tie approvals to the immutable file hash, mapping, selected sheets, company and reviewed row set. If revalidation changes that set, require a refreshed preview rather than importing newly discovered rows under the old approval.

New-company onboarding is a multi-step job: create company, provision access, seed missing designs, import master data, import opening quantities, then check readiness. Return per-step state and generated IDs. Never delete a partly configured company as an automatic rollback. A seed-admin token restricted to existing IDs must not gain a newly created company automatically; require an authorized scope/grant step or an All-companies token.

## Priority 3: tenant and staff provisioning

Users/roles/company settings are explicitly excluded in the current MCP design. The following is a proposed new boundary, not an existing permission granted by this report.

- prepare_tenant_access_setup: seed-admin-only plan for a tenant administrator, chosen Sales/Complete edition, explicit company grants, optional MCP Access/Write and token limits. Show the exact roles and companies, with no password or token in conversational output.
- get_access_summary: show the requesting user's effective companies/scopes; a seed-admin support tool may inspect a selected user without returning credentials.
- prepare_staff_access: a later tenant-admin tool bounded by management hierarchy, assignable companies and grantable permission keys. It cannot assign an edition or authority its owner does not possess.
- get_mcp_connection_status / get_my_mcp_activity: token scope/expiry and scoped recent outcomes. A separate seed-admin diagnostic can show cross-company activity and denied-call counts, without token hashes/secrets.

Provisioning needs a shared application service extracted from the existing controllers. Company creation currently adds management ownership and company grants in CompaniesController; calling CompanyService alone would omit that behavior. Preserve that orchestration, edition non-escalation and role tenant scope. Credentials must be set/delivered through a reviewed account setup flow; do not have the LLM invent or expose passwords. Never give a tenant a copy of the seed-admin token.

## Priority 4: daily operations

| Workflow | Proposed tools | Concrete benefit / conditions |
| --- | --- | --- |
| Morning work list | get_daily_work_queue(companyId, date) | Pending/unbilled challans, No-PO blockers, undelivered order quantities, overdue balances and local FBR setup blockers; IDs and screen links, no vague advice |
| Quote to delivery | get_quote, search_sales_orders, get_sales_order, prepare_quote_to_order, prepare_order_challan | Preserve source links and remaining quantities instead of retyping records into generic create tools |
| PO intake | inspect_uploaded_po, prepare_sales_order_from_po | Reuse registered formats/parsers and display uncertain fields; source upload is tenant-scoped and content is untrusted data |
| Missing purchase record | search_purchase_bills, get_purchase_bill, search_goods_receipts, prepare_purchase_bill, prepare_goods_receipt | Complete the buying side and stock intake through existing services; validate supplier, quantities, numbering and ledger lock date |
| Record collections | search_receipts, get_receipt, get_open_invoices, prepare_receipt | Suggest exact allocations, show amount/unallocated balance, prevent cross-party/tenant and over-allocation at commit |
| Supplier payments | search_payments, get_open_purchase_bills, prepare_payment | Same approval pattern on money out, using the payment service and matching permission |
| Withholding records | search_withholding_receipts, prepare_withholding_receipt | Record evidence supplied by the operator through the existing service; no inferred tax treatment |
| Stock questions | get_stock_movements, explain_stock_position, check_order_stock | Show opening balance and source-linked in/out movements, tracking enabled/disabled and classification; do not promise bill saving reserves stock |
| Accounts questions | get_trial_balance, get_profit_and_loss, get_balance_sheet, get_cash_book, get_aged_payables, get_party_ledger | Existing accounting report services and Complete-edition permissions; server-calculated figures with date/source semantics |
| Export and print | export_document, export_statement | Tenant-scoped, short-lived artifacts from actual document/report DTOs and approved templates; no automatic email/WhatsApp sending |
| Support | get_company_support_summary, get_document_history, explain_document_blockers | Redacted, scoped status/reason codes for a reported problem; tenant users see their own scope, seed admin selects any allowed company |

A daily queue must distinguish all commercial bills from sales_summary, which currently reports FBR-filed sale invoices. Label status/date rules and completeness; do not call the existing filed-sales report today's complete sales. Hide payment/accounting sections when the caller lacks their permissions. Build cross-company seed-admin summaries with per-company totals and partial/unavailable indicators rather than silently mixing tenant balances.

Low-stock recommendations can begin with negative quantities and explicit order demand. Reorder thresholds, lead times and supplier recommendations need new business data or user-confirmed assumptions; those are not present merely because get_stock exists.

Receipt/payment plans must expose allocations and cheque state, including whether a pending cheque affects settled balances under the service's own rules. Re-read open balances at commit. Partial delivery/conversion tools must call the dedicated conversion methods so source relationships, fulfillment and stock are preserved.

## Shared machinery before adding many write tools

1. get_mcp_capabilities: effective company scope, allowed operations/fields, edition limits, write scopes, file intake limits and plan expiration. Filter tool discovery as well as enforcing authorization on calls.
2. Scoped file/draft intake: authenticated upload endpoint issuing opaque upload IDs, company/user/token ownership, file type/size checks, checksum, retention and access revocation. MCP must not read arbitrary local paths or fetch arbitrary URLs. The current JSON-RPC request limit is 64 KiB, whereas onboarding uploads allow 10 MiB; large files/template projects cannot ride inline in ordinary tool arguments.
3. Shared operation services: extract reusable orchestration from controllers, especially template auditing/stamp checks and company ownership/grants. Do not internally call controllers or duplicate their rules in the MCP controller.
4. Draft/revision store: durable print drafts and onboarding jobs for review across sessions. Keep approved commit plans short-lived and single-use; the existing ten-minute plan lifetime is unsuitable as the only storage for a longer support/onboarding task.
5. get_action_status(planId/idempotencyKey): distinguish prepared, executing, succeeded, partial, failed and unknown outcome. Existing commit code claims a plan before performing its service operation; neither a claimed plan nor a timeout proves the operation succeeded. Reconcile by durable operation/result identity before retrying.
6. Approval enforcement: today the host is expected to obtain approval; commit_action receives a plan ID, not server-verifiable human consent. For template publication, provisioning and batch imports, add an authenticated review page that binds approval to company, exact payload/revision/hash and author. A plan ID alone must not become approval evidence.
7. New explicit scopes and permissions: templates.write, onboarding.write, suppliers.write, items.write, orders.write, purchases.write, receipts.write/payments.write, and a seed-admin-only provisioning scope are proposals, not current token capabilities. Add only the scope for the workflow being delivered; existing tokens must not silently gain new write rights. Separate sensitive reads from today's broad read scope where required.
8. Structured audit: company, actor/token, action/result identity, changed fields, before/after revision and redacted outcome. Return minimum necessary party details; never FBR secrets, password/token material, or full raw request logs. Apply one shared company guard to uploads, drafts, artifacts, previews, history and jobs as well as main tools.

The initial MCP instructions and class comment still say there are no write tools although the catalogue now exposes prepare/commit tools. Update that stale discovery guidance when implementing the first expansion. Documentation must describe draft storage separately from business-record writes.

## Boundaries

This proposal does not add SQL execution, arbitrary HTTP fetches, unattended FBR validation/submission, document deletion/voiding, access-role escalation, lock-date changes, ledger rebuilds, or bulk propagation of one tenant's print design. Local FBR readiness checks can be useful without calling PRAL. Any new capability outside the current design's exclusions needs its own reviewed change; this document authorizes none of those operations.

## Delivery order and proof

| Phase | Deliverable | Acceptance proof |
| --- | --- | --- |
| A | Capability discovery, print reads and document print contract | Tenant/staff cannot enumerate or load another company's templates, drafts or documents; restricted seed token remains restricted; seed All-companies token sees new companies |
| B | Code-mode template draft, faithful preview, versioned publish/restore | Existing designs/assets preserved; actual print DTO matches screen; missing fields, long/many-line layouts checked; stale edit rejected; denied/revoked/expired commit tested |
| C | Scoped upload plus onboarding preview/job/result/fix list | Identifier precision, uncertain mapping, duplicate skipping, per-sheet permission, file-hash approval, partial import/resume and re-upload create no duplicates |
| D | Seed-admin onboarding and access setup | Dedicated seed identity check; no tenant provisioning escalation; controller orchestration preserved; no secret output; new-company token restrictions tested |
| E | Daily queue, order conversion and purchase/receipt reads, then reviewed writes | Results equal existing screens/services; balances, fulfillment, stock and numbering contracts hold; duplicate/concurrent/timeout behavior verified |

Reuse the existing MCP isolation, tokens, self-service, OAuth, writes, seed-admin, reports and documents suites. For templates, use the repository's current render/merge-field/stamp/template-contract checks and add tenant/revision/render tests for the new behavior. For onboarding, use the offline harness, live onboarding tests, UI decision tests and tenant sweep. For sales/purchases/receipts, run the relevant arithmetic, stock-reflow, payment/withholding and accounting suites listed in CLAUDE.md. Do not change guarded expectations to accept a lost design or weaker tenant boundary.

No code, production data, permissions, database schema or deployment was changed while preparing this proposal. Validation for this document is the production-identifier verifier and a cleanly scoped diff; functional tests are not claimed.
