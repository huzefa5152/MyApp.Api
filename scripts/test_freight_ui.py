"""Verify the actual Customize freight field at phone, tablet and desktop widths."""
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

frontend = Path(__file__).resolve().parent.parent / "myapp-frontend"
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
with tempfile.TemporaryFile(mode="w+") as log:
    process = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1",
                                "--port", str(port), "--strictPort"], cwd=frontend, stdout=log, stderr=log)
    try:
        for attempt in range(120):
            with socket.socket() as sock:
                if sock.connect_ex(("127.0.0.1", port)) == 0:
                    break
            if process.poll() is not None:
                raise RuntimeError("Owned Vite server exited")
            time.sleep(0.25)
        else:
            raise RuntimeError("Owned Vite server did not start")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome")
            page = browser.new_page()
            for width in (375, 768, 1280):
                page.set_viewport_size({"width": width, "height": 850})
                page.goto(f"http://127.0.0.1:{port}/")
                page.evaluate("""async () => {
                    const rm = await import('/node_modules/.vite/deps/react.js');
                    const React = rm.default || rm;
                    const dm = await import('/node_modules/.vite/deps/react-dom_client.js');
                    const {createRoot} = dm.default || dm;
                    const {default:Freight} = await import('/src/Components/FreightChargesField.jsx');
                    document.body.replaceChildren(); document.body.style.margin = '8px';
                    const mount = document.createElement('div'); document.body.append(mount);
                    function App() {
                        const [freight, setFreight] = React.useState(0);
                        return React.createElement(Freight, {value:freight, onChange:setFreight});
                    }
                    createRoot(mount).render(React.createElement(App));
                }""")
                field = page.get_by_label("Freight / cartage charges (PKR)")
                expect(field).to_have_value("0")
                assert field.bounding_box()["height"] >= 44
                assert field.get_attribute("min") == "0"
                assert field.get_attribute("step") == "0.01"
                field.fill("4000.50")
                expect(field).to_have_value("4000.50")
                field.fill("")
                expect(field).to_have_value("")
                field.fill("0")
                expect(field).to_have_value("0")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                print(f"PASS {width}px: actual freight field edits/clears, money precision, 44px target, no overflow")
            browser.close()
    finally:
        process.terminate()
        process.wait(timeout=15)
print("3/3 freight UI viewport cases passed")
