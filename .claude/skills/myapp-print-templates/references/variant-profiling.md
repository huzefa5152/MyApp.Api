# Profile another MyApp.Api production variant

Use this when the selected production branch has no verified print profile. Share the matching workflow, not Trader's design or data assumptions. The user intends separate merge-field guidance for the other production lines as they are requested; do not pre-fill those profiles from Trader.

For the selected branch and requested document types:

1. Read that branch's environment notes, print DTOs, service projections, controllers, serializer settings, merge engine, starter/default definitions, and editor/stamp resolution. Branch ancestry is not proof of identical behavior.
2. Obtain representative read-only print JSON from the intended environment when access is available. Record exact key casing, nullability, source collections, original/adjusted quantity semantics, tax basis and totals, branding aliases, supported helpers, FBR conditions, and stamp behavior. Identify code-only fields not yet deployed separately. Without live access, mark the contract as source-verified only; continue a local draft and explain what remains unverified.
3. Map the user's reference fields to this contract. Record missing fields and prepare narrowly scoped implementation work where authorized. Do not fill missing fields with another branch's tokens, fake values, or hidden calculations in HTML.
4. Document branch, source locations, document types, layout requirements, supported fields, representative verification cases, deployment base path, and checks. Keep production credentials, concrete connection details, customer identifiers, and real documents outside skill files. Prefer source paths and semantics over copying entire DTO catalogs that will go stale.
5. When asked to create that variant's skill/profile, write it separately and link it from the main skill's branch table. Include only behavior actually verified for that variant. Validate its skill frontmatter if it is a standalone skill. Do not merge production branches or port code as a side effect of documenting a profile.

Acceptance examples for this skill family:

- A Trader reference requests original Bill quantities but adjusted tax-invoice quantities: choose each endpoint's corresponding collection and preserve that distinction despite matching appearance.
- A customize/importer reference requests additional columns: inspect its branch and actual JSON; do not assume Trader tokens exist.
- A stamp-free duplicate is requested: preserve the duplicate's no-stamp assignment, even if a default company stamp exists.
- A PDF has a sample invoice number or tax registration: use dynamic fields from the target company, not the sample literals.
- A template-only task is authorized: draft and verify its saved-template update without changing global defaults or other tenant templates.
