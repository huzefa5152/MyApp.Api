# Preprinted letterhead templates

Trader templates may opt into blank stationery space on every A4 page:

```html
<div data-print-letterhead-top="60" data-print-letterhead-bottom="50">
  <!-- Document content, without the preprinted branding. -->
  <div data-print-final-block>Signature or closing content</div>
</div>
```

Margins are millimetres and must leave at least 50 mm for content. Keep the
content padding separate from these reserved margins. The optional final block
stays together at the bottom of the last usable page. Table headings repeat
when a table continues; oversized rows are rejected instead of clipped.

PDF and browser printing share the same page composition. Browser printing
uses page images for these opt-in templates; ordinary templates retain their
existing printing behavior. Print at actual size on A4 with browser headers
and footers disabled. Bulk printing composes each document separately.

Verify with `python scripts/test_letterhead_pagination.py` and the existing
PDF pagination and table-heading suites. Company-specific templates and assets
remain in the company template store, outside the public repository.
