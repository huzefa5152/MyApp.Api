"""Opt-in letterhead margins in PDF and browser print, using synthetic fixtures."""
import tempfile
from pathlib import Path
import pymupdf
from playwright.sync_api import sync_playwright
from test_pdf_pagination import ViteServer, free_port, HARNESS_PATH
from test_pdf_table_headings import CASE

CASE = CASE.replace('<body><h1>', '<body><div data-print-letterhead-top="59" data-print-letterhead-bottom="60"><h1>')
CASE = CASE.replace('<div class="closing">', '<div class="closing" data-print-final-block>')
CASE = CASE.replace('</body></html>', '</div></body></html>').replace('310 : 165', '310 : 120')


def main():
    with tempfile.TemporaryDirectory() as directory, ViteServer(free_port()) as vite, sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(accept_downloads=True)
        page.goto(f'http://127.0.0.1:{vite.port}{HARNESS_PATH}')
        page.wait_for_function('window.__HARNESS_READY__ === true')
        for signed, count, tall in [(False, 2, False), (True, 20, False), (False, 20, False), (True, 12, True)]:
            case = dict(signed=signed, count=count, tall=tall, oversized=False)
            with page.expect_download() as download:
                result = page.evaluate(CASE, case)
                assert 'error' not in result, result
            path = Path(directory)/'letterhead.pdf'
            download.value.save_as(path)
            pdf = pymupdf.open(path)
            layout, measured = result['layout'], result['measured']
            assert layout['margins'] == {'top':59, 'bottom':60}
            assert layout['scale'] == 1 and len(pdf) == layout['pages']
            assert len(pdf) == 1 if count == 2 else len(pdf) >= 3
            for row in measured['rows']:
                assert sum(part['start'] <= row['start'] + 1 and part['end'] >= row['end'] - 1 for part in layout['pageSlices']) == 1
            stamp_pages=[]
            for index, pdf_page in enumerate(pdf):
                pix=pdf_page.get_pixmap()
                for y_mm in [2,20,55,240,270,295]:
                    y=round(y_mm/25.4*72)
                    assert all(min(pix.pixel(x,y)[:3]) > 240 for x in range(0,pix.width,5)), ('margin overlap',index,y_mm)
                if any((lambda c:c[0]>180 and c[1]<90 and c[2]>180)(pix.pixel(x,y)[:3]) for y in range(0,pix.height,4) for x in range(0,pix.width,4)):
                    stamp_pages.append(index)
                part=layout['pageSlices'][index]
                if index and part['repeatedHeader']:
                    rgb=pix.pixel(round(12/25.4*72),round(60/25.4*72))[:3]
                    assert rgb[2]>rgb[0]+30, ('heading missing',index,rgb)
            assert stamp_pages == ([len(pdf)-1] if signed else [])
            if signed:
                pix=pdf[-1].get_pixmap()
                assert any((lambda c:c[0]>180 and c[1]<90 and c[2]>180)(pix.pixel(x,y)[:3]) for y in range(round(195/25.4*72),round(237/25.4*72),3) for x in range(0,pix.width,3)), 'signature is not at the final page bottom'
            pdf.close()
            print('PASS PDF letterhead',case,layout['pages'],'pages',flush=True)
        result=page.evaluate(CASE,dict(signed=True,count=8,tall=False,oversized=True))
        assert 'taller than a PDF page' in result.get('error',''),result
        # Browser print composes pages with the same pagination function.
        prepared=page.evaluate("""async()=>{const {prepareLetterheadPrint}=await import('/src/utils/exportUtils.js');return await prepareLetterheadPrint('<html><head><style>body{margin:0;padding:8mm}table{width:100%;border-collapse:collapse}th{background:#143d6b;color:white;height:8mm}td{height:20mm;border:1px solid black}.closing{height:20mm;break-inside:avoid}</style></head><body><div data-print-letterhead-top="59" data-print-letterhead-bottom="60"><table><thead><tr><th>Sample headings</th></tr></thead><tbody>'+Array.from({length:20},(_,i)=>'<tr><td>Sample row '+i+'</td></tr>').join('')+'</tbody></table><div class="closing" data-print-final-block>Sample final signature</div></div></body></html>')}""")
        assert prepared.count('<section>') >= 3
        printed=browser.new_page()
        printed.set_content(prepared)
        printed.pdf(path=str(Path(directory)/'browser-print.pdf'),prefer_css_page_size=True,print_background=True)
        with pymupdf.open(Path(directory)/'browser-print.pdf') as pdf:
            assert len(pdf)==prepared.count('<section>')
        print('PASS browser Print uses the same complete letterhead pages',flush=True)
        bulk = page.evaluate("""async()=>{
          const {prepareLetterheadPrint,buildMergedPrintDocument}=await import('/src/utils/exportUtils.js');
          const doc='<html><head><style>body{padding:8mm}.closing{height:20mm}</style></head><body><div data-print-letterhead-top="59" data-print-letterhead-bottom="60"><h1>Sample bulk document</h1><div class="closing" data-print-final-block>Sample signature</div></div></body></html>';
          const ordinary='<html><body>Ordinary document</body></html>';
          if(await prepareLetterheadPrint(ordinary)!==ordinary)throw Error('Ordinary HTML changed');
          let rejected=false;
          try{await prepareLetterheadPrint(doc.replace('bottom="60"','bottom="260"'))}catch{rejected=true}
          if(!rejected)throw Error('Invalid margins accepted');
          return await prepareLetterheadPrint(buildMergedPrintDocument([doc,doc]));
        }""")
        printed.set_content(bulk)
        printed.pdf(path=str(Path(directory)/'bulk-print.pdf'),prefer_css_page_size=True,print_background=True)
        with pymupdf.open(Path(directory)/'bulk-print.pdf') as pdf:
            assert len(pdf)==2, ('bulk document boundaries',len(pdf))
        print('PASS bulk letterhead printing, ordinary pass-through and invalid margins',flush=True)

        browser.close()
    print('all checks passed (9 letterhead pagination scenarios)',flush=True)


if __name__ == '__main__':
    main()
