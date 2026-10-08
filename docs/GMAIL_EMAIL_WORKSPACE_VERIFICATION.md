# Customize Email Workspace verification

This is a deliberate port of Trader's optional Email Workspace (502b3e39), without merging the Trader production line. Customize retains division numbering, price/quantity precision, inventory and print templates. It uses a newly generated AddEmailWorkspace migration containing only the six email tables and indexes.

Verification is performed on .NET 9 and disposable local SQL databases with Gmail sync disabled. The SQL workflow uses a fake Gmail provider and the real quotation service; real Google consent and the user's example emails have not been tested.

Customize-specific acceptance covers restricted division writes: null and ungranted divisions are refused, foreign-company divisions are refused, an assigned division creates a correctly scoped quotation with the expected totals, and revoked grants cannot retrieve an existing conversion through the idempotency path. Contact information is retained in notes.

Live Google OAuth, reconnect, email arrival, attachment download and the cached-mail retention policy remain required before tenant rollout. No push or deployment is authorized.
