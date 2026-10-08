"""Verify PO tabs and selection on phone, tablet and desktop."""
from playwright.sync_api import sync_playwright
from test_pdf_pagination import ViteServer, free_port
with ViteServer(free_port()) as server, sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    page=browser.new_page()
    page.on("pageerror", lambda e: print("Browser error:",e))
    for width in [375,768,1280]:
        page.set_viewport_size(dict(width=width,height=850))
        page.goto(f'http://127.0.0.1:{server.port}/src/devtools/pdfPaginationHarness.html')
        page.wait_for_function('window.__HARNESS_READY__')
        page.evaluate("""async () => {
            const reactModule=await import('/node_modules/.vite/deps/react.js');const React=reactModule.default || reactModule;
            const domModule=await import('/node_modules/.vite/deps/react-dom_client.js');const {createRoot}=domModule.default || domModule;
            const {default:Picker}=await import('/src/Components/ChallanBillingPicker.jsx');
            document.body.replaceChildren();document.body.style.margin='8px';
            const root=document.createElement('div');document.body.append(root);
            const challans=[{id:1,challanNumber:101,poNumber:'SAMPLE-PO',poDate:'2026-10-01',items:[]},{id:2,challanNumber:102,poNumber:'SAMPLE-PO',poDate:'2026-10-01',items:[]},{id:3,challanNumber:103,poNumber:'',items:[]},{id:4,challanNumber:104,poNumber:'',items:[]}];
            function App(){const [ids,setIds]=React.useState([]);return React.createElement(Picker,{challans,selectedIds:ids,onChange:setIds});}
            createRoot(root).render(React.createElement(App));
        }""")
        page.get_by_role('button',name='Select this PO').click()
        assert page.get_by_role('status').inner_text().startswith('2 challans selected')
        page.get_by_role('tab',name='Without PO (2)').click()
        page.get_by_role('checkbox',name='Select challan 103',exact=True).check()
        assert page.get_by_role('status').inner_text().startswith('3 challans selected')
        page.get_by_role('button',name='Select shown').click()
        assert page.get_by_role('status').inner_text().startswith('4 challans selected')
        page.get_by_role('tab',name='With PO (2)').click()
        assert page.get_by_role('checkbox',name='Select challan 101',exact=True).is_checked()
        page.get_by_role('button',name='Select this PO').click()
        assert page.get_by_role('status').inner_text().startswith('2 challans selected')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        print(f'PASS {width}px: PO group, single/multiple no-PO selection, cross-tab preservation, no overflow')
    page.evaluate("""async () => {
        const reactModule=await import('/node_modules/.vite/deps/react.js');const React=reactModule.default || reactModule;
        const domModule=await import('/node_modules/.vite/deps/react-dom_client.js');const {createRoot}=domModule.default || domModule;
        const tableSource=await (await fetch('/src/Components/InvoiceTable.jsx')).text();
        const routerPath=tableSource.match(/from [\"']([^\"']*react-router-dom[^\"']*)[\"']/)[1];
        const {MemoryRouter}=await import(routerPath);
        const {default:Table}=await import('/src/Components/InvoiceTable.jsx');
        document.body.replaceChildren();const root=document.createElement('div');document.body.append(root);
        const view=createRoot(root);window.renderFbrTable=(ready)=>view.render(React.createElement(MemoryRouter,null,React.createElement(Table,{invoices:[{id:1,invoiceNumber:1,date:'2026-10-03',clientName:'Sample buyer',grandTotal:100,challanNumbers:[],items:[],fbrReady:ready}],isBillsMode:false,perms:{canFbrAny:true,canFbrValidate:true,canFbrSubmit:true},selectedCompanyHasFbrToken:true,fbrValidated:new Set()})));window.renderFbrTable(true);
    }""")
    page.get_by_text('Sample buyer',exact=True).wait_for()
    page.get_by_role('button',name='Validate this bill with FBR (dry-run)',exact=True).wait_for()
    assert page.get_by_role('button',name='Validate first before submitting.',exact=True).count()==1
    page.evaluate('window.renderFbrTable(false)')
    page.get_by_role('button',name='Validate this bill with FBR (dry-run)',exact=True).wait_for(state='detached')
    assert page.get_by_role('button',name='Validate this bill with FBR (dry-run)',exact=True).count()==0
    assert page.get_by_role('button',name='Complete FBR setup first.',exact=True).count()==0
    print('PASS incomplete setup: FBR validate and submit actions hidden')
    browser.close()
print('3/3 viewport cases passed')
