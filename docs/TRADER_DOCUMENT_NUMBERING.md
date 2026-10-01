# Company document numbering

Sales quotes, delivery challans, purchase bills and goods receipts offer Auto
and Custom numbering when created. Existing edit and view screens retain the
saved number. Each company and document type has its own sequence.

Auto continues one number beyond the company counter, respecting its starting
number, and skips numbers already used. Custom requires an unused positive whole
number and reserves it without moving that Auto counter. With current 499 and
Custom 501, Auto issues 500, then skips 501 and issues 502. A distant custom number
such as 5000 does not jump the Auto sequence. Existing stored company counters
are preserved; historical custom numbers are not used to rewind them.

Allocation locks the company row inside the document transaction. The Auto counter
and document commit or roll back together, including across application
processes. Purchase bills generated from challans or FBR purchase imports use
the same allocator. Preview checks are advisory; save checks enforce uniqueness.

Delivery challan numbers below 900000 are available for normal documents. The
existing explicit Duplicate Challan operation intentionally retains the same
number and remains an exception. Demo challans retain their separate sequence.
No database index or migration is added for numbering.

Number previews require company access and the corresponding document-create
permission. Existing print templates are unchanged.

## Local verification

- Auto/Custom numbering: 122/122, including both bill-create paths, rollback,
  cross-company reuse, concurrent Custom and Auto saves across two app processes.
- Existing bill-number suite: 47/47, including simulated FBR-filed locks. Its
  former highest-custom-number expectations were updated with maintainer approval
  to protect the new cursor-and-skip rule.
- Basic flows: 72/72. Inventory reflow: 183/183. Security boundaries: 602/602.
- Synthetic FBR purchase import: custom 500 did not move the cursor; five imports
  starting at 499 skipped 500 and left next Auto 505. Five imported, zero failed.
- Backend and frontend builds passed. Existing stored company cursors are retained.

All write tests used disposable local data. No production writes, push or deploy.
