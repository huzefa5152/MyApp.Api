"""Exercise commercial freight and unchanged withholding base at three viewports."""
from playwright.sync_api import sync_playwright, expect
from test_pdf_pagination import ViteServer, free_port

with ViteServer(free_port()) as server, sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    for width in (375, 768, 1280):
        page.set_viewport_size({"width": width, "height": 850})
        page.goto(f"http://127.0.0.1:{server.port}/src/devtools/pdfPaginationHarness.html")
        page.wait_for_function("window.__HARNESS_READY__")
        page.evaluate("""async () => {
            const rm = await import('/node_modules/.vite/deps/react.js');
            const React = rm.default || rm;
            const dm = await import('/node_modules/.vite/deps/react-dom_client.js');
            const {createRoot} = dm.default || dm;
            const {default:Freight} = await import('/src/Components/FreightChargesField.jsx');
            const {default:Taxes} = await import('/src/Components/DocumentTaxFields.jsx');
            document.body.replaceChildren(); document.body.style.margin = '8px';
            const root = document.createElement('div'); document.body.append(root);
            function App() {
                const [freight, setFreight] = React.useState(0);
                const [withholding, setWithholding] = React.useState({rate:2, amount:null});
                return React.createElement(React.Fragment, null,
                    React.createElement(Freight, {value:freight, onChange:setFreight}),
                    React.createElement(Taxes, {subtotal:27426, gstAmount:4936.68,
                        freightCharges:Number(freight || 0), withholdingTaxRate:withholding.rate,
                        withholdingTaxAmount:withholding.amount, onWithholdingChange:setWithholding}));
            }
            createRoot(root).render(React.createElement(App));
        }""")
        field = page.get_by_label("Freight / cartage charges (PKR)")
        expect(field).to_have_value("0")
        expect(page.get_by_text("Rs. 32,362.68", exact=True)).to_be_visible()
        expect(page.get_by_text("− Rs. 647.25", exact=True)).to_be_visible()
        assert field.bounding_box()["height"] >= 44
        field.fill("4000")
        expect(field).to_have_value("4000")
        expect(page.get_by_text("Rs. 36,362.68", exact=True)).to_be_visible()
        expect(page.get_by_text("− Rs. 647.25", exact=True)).to_be_visible()
        expect(page.get_by_text("Rs. 35,715.43", exact=True)).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        field.fill("0")
        expect(page.get_by_text("Rs. 32,362.68", exact=True)).to_be_visible()
        expect(page.get_by_text("Rs. 31,715.43", exact=True)).to_be_visible()
        assert not errors, errors
        print(f"PASS {width}px: freight edit/clear, commercial total, unchanged WHT base, 44px target, no overflow")
    browser.close()
print("3/3 freight UI viewport cases passed")
