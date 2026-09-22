# AGENTS.md — rules for every coding agent in this repository

**`CLAUDE.md` in this directory is the single source of truth.** Read it in
full before you change anything: environments and which branch maps to which
production install, tenant isolation, permissions, responsive UI, the test
table, commit identity, and the production-identifier rule. This file exists so
that agents which do not load `CLAUDE.md` automatically still get the rules
that have cost the most when they were broken.

## The repository is PUBLIC

Never commit a production database name, SQL host, FTP host, login, password,
API key or FBR token — not in prose, a code comment, a docstring or a commit
message. Use a placeholder. Run
`python scripts/verify_no_production_identifiers.py` whenever you touch docs,
comments or scripts. Scrubbing afterwards does not help: the value stays in the
pushed history.

## Four production installations, one per branch

`master`, `customize-solution-for-other`, `feat/importer-ledger-receipts` and
`TraderFbrInvoicingSystem` are separate live products with separate databases.
**Never merge one into another.** The branch selects the local database by
itself — checking one out is the whole switch. Production databases are
READ-ONLY; no write without the maintainer's say-so in that same conversation.

## One commit does one thing

Stage explicit paths: `git commit -F <msgfile> -- <paths>`. Never `git add -A`.
Read `git diff --stat` before committing and account for every file in it — a
file the subject line does not explain does not belong in the commit.

A commit titled "Refuse to delete an item type that still holds stock" once
also deleted 3,576 lines of print templates, replacing 30 distinct document
designs with colour variants of one generated layout. It shipped unreviewed and
reached operators. Deleting user-visible variety — designs, templates, presets,
sample data — is its own change, needs its own commit, and needs the
maintainer's agreement before it is written.

## Never re-baseline a test to make your change pass

That same commit rewrote the template test to assert the new single layout, so
the suite passed and the deletion looked verified. If a change makes a test
fail, decide whether the TEST is wrong and take that to the maintainer — do not
edit the assertion in the same commit as the behaviour it guards. Assert the
contract (the table renders, the totals appear, no `NaN`), never one
implementation's shape (exactly eight `<th>`).

## Verify before you claim

`CLAUDE.md` holds the full test table with the exact command and expected
output for each suite. Compiling is not verifying. Run what your change
touches, paste the real output, and say plainly what you did not run.

## Ask before commit, push or deploy

Each one needs fresh confirmation from the maintainer, every time. Commits are
authored as the personal GitHub account (`git config user.email` must be the
`45231321+huzefa5152` noreply address). Never add an AI-attribution or
`Co-Authored-By` trailer to a commit message.
