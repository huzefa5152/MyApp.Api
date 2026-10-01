# Optional sales-quote line photos

Each quotation line may have a photo, or none. Create/edit offers a photo picker
with replacement and removal; View shows uploaded thumbnails. File validation,
quote-save path validation, company grants and quote permissions apply server-side.
Photo URLs are private and use the existing authenticated image session for normal
browser preview/printing. No invoice, stock, price, tax or order behavior changes.

Existing quotes keep null image values. The migration adds one nullable column.
Existing system templates are unchanged. To show a photo on a requested client
template, use this inside the quotation's existing `{{#each items}}` loop:

```html
{{#if this.imagePath}}
<img src="{{this.imagePath}}" alt="Product photo"
     style="width:80px;height:80px;object-fit:contain;">
{{/if}}
```

Clearing a line removes its reference, not the file: another line/quote may still
reference that company-owned upload. Abandoned draft uploads can therefore remain
on disk. Storage cleanup must reconcile references rather than delete files during
quote saves. Photos are not copied to the resulting sales order or FBR payload.

All work and verification are local. Production migration, push and deployment
remain on hold at the maintainer's request.

## Local verification

- Backend build: 0 errors, 11 existing nullable warnings. Frontend production
  build passed with existing duplicate-property and bundle-size warnings.
- Final security regression: 581/581 checks passed, including upload ownership,
  anonymous/foreign/no-assignment image access, quote permission removal,
  image cookie access, forged paths and unchanged totals after photo removal.
- Basic flows: 72/72; stock item-type reflow: 183/183.
- Migration/field checks: 3/3; the nullable column is applied locally, existing
  photo-free lines remain valid and the photo merge field is seeded once.
- Chrome verified upload, save, edit and view with a synthetic 160-by-100 photo,
  responsive controls at 375/768/1280 pixels, and a saved quote with quantity 2,
  subtotal 200, GST 36 and total 236. A new disposable test template printed
  the photo, and its downloaded one-page PDF was rendered and inspected.

The Excel merge dictionary exposes the image URL as a value; it does not embed
an Excel picture automatically. No existing template gained an image column.
