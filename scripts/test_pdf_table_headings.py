"""Real PDF regression: repeated multi-row headings, intact rows, final stamp.

Run with python scripts/test_pdf_table_headings.py.
Requires playwright (Chromium installed) and pymupdf. No backend or database.
Fixtures are synthetic; downloaded PDFs are kept only in a temporary directory.
"""
import tempfile
from pathlib import Path

import pymupdf
from playwright.sync_api import sync_playwright
from test_pdf_pagination import ViteServer, HARNESS_PATH, free_port


CASE = r"""async ({signed, tall, oversized, count}) => {
  const {exportToPdf} = await import('/src/utils/exportUtils.js');
  const image = document.createElement('canvas'); image.width = 100; image.height = 40;
  const ctx = image.getContext('2d'); ctx.fillStyle = '#ff00ff'; ctx.fillRect(0,0,100,40);
  const rows = Array.from({length:count}, (_,i) =>
    `<tr style="height:${i===2 && (tall || oversized) ? (oversized ? 310 : 165) : 28}mm"><td>Row ${i+1}</td><td>Wrapped description<br>Second line</td></tr>`).join('');
  const html = `<html><head><style>
    *{box-sizing:border-box}body{margin:0;padding:8mm;font:12px Arial}
    table{border-collapse:collapse;width:100%;table-layout:fixed}
    thead{background:#143d6b;color:white}th{height:7mm}
    td{border:1px solid #777;vertical-align:top}
    tr,.closing{break-inside:avoid;page-break-inside:avoid}
    .closing{margin-top:8mm;height:40mm}
  </style></head><body><h1>SAMPLE DOCUMENT</h1><table>
    <thead><tr><th colspan="2">SAMPLE COLUMN HEADINGS</th></tr><tr><th>Number</th><th>Description</th></tr></thead>
    <tbody>${rows}</tbody></table><div class="closing">SAMPLE FINAL TOTAL
    ${signed ? `<img class="stamp" src="${image.toDataURL()}" style="display:block;width:25mm;height:10mm">` : ''}
    SAMPLE SIGNATURE LABEL</div></body></html>`;
  let measured;
  try {
    const layout = await exportToPdf(html,'sample',{onLayout:({content,...info})=>{
      const origin=content.getBoundingClientRect().top;
      const bounds=el=>{const r=el.getBoundingClientRect();return {start:(r.top-origin)*info.pxRatio,end:(r.bottom-origin)*info.pxRatio}};
      measured={rows:Array.from(content.querySelectorAll('tbody tr')).map(bounds),closing:bounds(content.querySelector('.closing'))};
    }});
    return {layout,measured};
  } catch(error) {return {error:error.message};}
}"""


def main():
    cases = [
        dict(signed=False, tall=False, oversized=False, count=2),
        dict(signed=True, tall=False, oversized=False, count=20),
        dict(signed=False, tall=False, oversized=False, count=20),
        dict(signed=True, tall=True, oversized=False, count=12),
    ]
    with tempfile.TemporaryDirectory() as directory, ViteServer(free_port()) as vite, sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(accept_downloads=True)
        page.goto(f'http://127.0.0.1:{vite.port}{HARNESS_PATH}')
        page.wait_for_function('window.__HARNESS_READY__ === true')
        for case in cases:
            with page.expect_download() as download:
                result = page.evaluate(CASE, case)
                assert 'error' not in result, result
            path = Path(directory) / 'sample.pdf'
            download.value.save_as(path)
            pdf = pymupdf.open(path)
            layout, measured = result['layout'], result['measured']
            assert len(pdf) == layout['pages']
            if case['count'] == 2:
                assert len(pdf) == 1
            else:
                assert len(pdf) >= 2
                slices = layout['pageSlices']
                assert slices[0]['start'] == 0 and slices[-1]['end'] == layout['heightPx']
                for index, part in enumerate(slices):
                    assert part['start'] == (slices[index-1]['end'] if index else 0)
                    for row in measured['rows'] + [measured['closing']]:
                        assert not row['start'] + 1 < part['end'] < row['end'] - 1
                    # Inspect the actual PDF pixels, not just the layout report:
                    # every continuation with item rows must begin with a blue header.
                    has_items = any(row['start'] < part['end'] and row['end'] > part['start'] + 1 for row in measured['rows'])
                    assert bool(part['repeatedHeader']) == bool(index and has_items)
                    if index and has_items:
                        pix = pdf[index].get_pixmap()
                        for offset_mm in (1, 8):
                            x, y = round(12 / 25.4 * 72), round((8 + offset_mm) / 25.4 * 72)
                            red, green, blue = pix.pixel(x, y)[:3]
                            assert blue > red + 30 and blue > green + 10, (index, (red, green, blue))
            # A magenta fixture stamp must occur on exactly the last page, and
            # never in the unsigned variant (PDFs here contain raster images).
            stamp_pages = []
            for index, pdf_page in enumerate(pdf):
                pix = pdf_page.get_pixmap()
                found = any(
                    (lambda rgb: rgb[0] > 180 and rgb[1] < 90 and rgb[2] > 180)(pix.pixel(x, y)[:3])
                    for y in range(0, pix.height, 4) for x in range(0, pix.width, 4)
                )
                if found:
                    stamp_pages.append(index + 1)
            assert stamp_pages == ([len(pdf)] if case['signed'] else []), stamp_pages
            pdf.close()
            print('PASS', case)
        downloads = []
        page.on('download', lambda download: downloads.append(download))
        result = page.evaluate(CASE, dict(signed=True, tall=False, oversized=True, count=8))
        assert 'taller than a PDF page' in result.get('error', ''), result
        assert not downloads, 'Oversized rows must not produce a clipped PDF'
        browser.close()
    print('all checks passed (5 PDF heading/stamp/row scenarios)')


if __name__ == '__main__':
    main()
