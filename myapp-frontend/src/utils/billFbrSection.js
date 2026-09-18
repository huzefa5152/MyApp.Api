// Shared by new designs and the render-time upgrade of saved Bill templates.
// Keep assets inline, matching the tax invoice: printing must not fetch a QR
// from an external service or depend on the site's /admin base path.
export const BILL_FBR_SECTION = `
{{#if (eq fbrStatus "Submitted")}}{{#if fbrIRN}}
<div data-bill-fbr="true" class="no-break" style="break-inside:avoid;page-break-inside:avoid;margin:14px 0;padding:8px 12px;border:1.5px solid #1a5276;border-radius:4px;display:flex;justify-content:space-between;align-items:center;gap:16px">
  <div style="flex:1;min-width:0;overflow-wrap:anywhere">
    <div style="font-size:9pt;font-weight:bold;color:#1a5276;margin-bottom:4px">FBR Digital Invoice</div>
    <div style="font-size:9pt"><strong>IRN:</strong> {{fbrIRN}}</div>
    {{#if fbrSubmittedAt}}<div style="font-size:8pt;color:#555;margin-top:2px">Submitted: {{fmtDate fbrSubmittedAt}}</div>{{/if}}
  </div>
  <div style="display:flex;gap:10px;align-items:center;flex-shrink:0">
    {{#if fbrQrPngDataUrl}}<div style="text-align:center">
      <img src="{{fbrQrPngDataUrl}}" style="display:block;width:96px;height:96px" alt="FBR Verify QR" />
      <div style="font-size:7pt;color:#555;margin-top:2px">Scan to verify</div>
    </div>{{/if}}
    {{#if fbrLogoUrl}}<img src="{{fbrLogoUrl}}" style="width:80px;height:80px;object-fit:contain" alt="FBR" />{{/if}}
  </div>
</div>
{{/if}}{{/if}}
`;

export function withBillFbrSection(html) {
  if (!html || /data-bill-fbr\s*=|\{\{\{?\s*fbrQrPngDataUrl\s*\}\}\}?/i.test(html)) return html;
  // Prefer the signature/footer boundary. Unknown custom layouts retain their
  // contents and get the block at the end of the document.
  const footer = /<div\b[^>]*class=["'][^"']*\b(?:footer-section|footer-sect|sig-row|sigs|signatures)\b[^"']*["'][^>]*>/i;
  if (footer.test(html)) return html.replace(footer, (tag) => BILL_FBR_SECTION + tag);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, (tag) => BILL_FBR_SECTION + tag);
  return html + BILL_FBR_SECTION;
}
