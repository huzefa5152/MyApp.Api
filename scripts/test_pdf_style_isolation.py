"""PDF exports must leave the live application's layout and styles intact."""
from playwright.sync_api import sync_playwright
from test_pdf_pagination import ViteServer, free_port

with ViteServer(free_port()) as server, sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(accept_downloads=True)
    for width in [375, 768, 1280]:
        page.set_viewport_size({"width": width, "height": 850})
        page.goto(f"http://127.0.0.1:{server.port}/src/devtools/pdfPaginationHarness.html")
        page.wait_for_function("window.__HARNESS_READY__")
        result = page.evaluate("""async () => {
          const { exportToPdf, renderPdfBlob, createStyledContainer } = await import('/src/utils/exportUtils.js');
          const app = document.createElement('main'); app.id='root'; app.className='container';
          app.textContent='Challan screen'; document.body.appendChild(app);
          const measure = () => ({width:app.getBoundingClientRect().width, font:getComputedStyle(app).fontSize, body:getComputedStyle(document.body).display});
          const before=measure();
          const css='html{width:796px!important} #root{width:500px!important} .container{max-width:500px!important} *{font-size:9px!important} body{display:grid!important}';
          const html='<html><head><style>'+css+'</style></head><body><h1>Sample challan</h1><table><tr><td>1</td><td>Sample goods</td></tr></table></body></html>';
          const mounted=createStyledContainer(css,'<p>Sample challan</p>');
          const during=measure(); mounted.wrapper.remove();
          const snapshots=[];
          for (const name of ['card','table']) {
            await exportToPdf(html,name,{onLayout:()=>snapshots.push(measure())});
            snapshots.push(measure());
          }
          const blob=await renderPdfBlob(html); snapshots.push(measure());
          return {before,during,snapshots,pdfBytes:blob.size,leftovers:document.querySelectorAll('iframe').length};
        }""")
        assert result["during"] == result["before"], result
        assert all(s == result["before"] for s in result["snapshots"]), result
        assert result["pdfBytes"] > 1000 and result["leftovers"] == 0, result
        print(f"PASS {width}px: live layout intact during/after card, table and blob export; PDF generated; cleanup complete")
    browser.close()
print("3/3 viewport cases passed")
