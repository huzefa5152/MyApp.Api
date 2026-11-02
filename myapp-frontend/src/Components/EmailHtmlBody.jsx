import { useEffect, useRef, useState } from "react";
import { FiImage } from "react-icons/fi";

/**
 * Shows an email's HTML the way a mail client does, without trusting it.
 *
 * The sender wrote this markup, so it never enters our page. It is rendered in
 * an iframe that is sandboxed with NO allow-scripts (nothing in it can run) and
 * carries its own Content-Security-Policy: no scripts, no frames, no forms, no
 * fetches. allow-same-origin is there only so this component can measure the
 * frame's height and fix up its links; with scripts off, the frame itself can
 * use none of it.
 *
 * Remote images are blocked until the operator asks for them, as Gmail does:
 * loading one tells the sender the email was opened, and from where.
 */
const stripActive = html => String(html || "")
  // A meta refresh would navigate the frame to the sender's page.
  .replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
  .replace(/<(script|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, "")
  .replace(/<(script|iframe|object|embed|base)\b[^>]*>/gi, "");

const hasRemoteImages = html => /<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /url\(\s*['"]?\s*(https?:)?\/\//i.test(html) || /background\s*=\s*["']?\s*(https?:)?\/\//i.test(html);

export default function EmailHtmlBody({ html, title = "Email" }) {
  const frame = useRef(null);
  const [height, setHeight] = useState(160);
  const [showImages, setShowImages] = useState(false);
  const clean = stripActive(html);
  const remote = hasRemoteImages(clean);
  useEffect(() => { setShowImages(false); }, [html]);

  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:${showImages ? " https: http:" : ""}; form-action 'none'; frame-src 'none'`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
html,body{margin:0;padding:0;background:#fff}
body{padding:2px 0 8px;font:14px/1.55 Arial,Helvetica,sans-serif;color:#202124;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
table{max-width:100%}
pre{white-space:pre-wrap}
a{color:#1a73e8}
blockquote{margin:0 0 0 .8ex;padding-left:1ex;border-left:1px solid #ccc}
</style></head><body>${clean}</body></html>`;

  useEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    let observer;
    const fit = () => {
      const d = el.contentDocument;
      if (!d?.documentElement) return;
      setHeight(Math.max(60, Math.ceil(d.documentElement.scrollHeight)));
    };
    const onLoad = () => {
      const d = el.contentDocument;
      if (!d) return;
      // Every link opens outside the app, and the opened page gets no handle
      // back to this window.
      d.querySelectorAll("a[href]").forEach(a => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
      fit();
      if (typeof ResizeObserver !== "undefined" && d.body) { observer = new ResizeObserver(fit); observer.observe(d.body); }
      d.querySelectorAll("img").forEach(img => img.addEventListener("load", fit));
    };
    el.addEventListener("load", onLoad);
    return () => { el.removeEventListener("load", onLoad); observer?.disconnect(); };
  }, [doc]);

  return <div className="em-html">
    {remote && !showImages && <div className="em-images-bar" role="note">
      <FiImage aria-hidden="true" /><span>Images from the sender are hidden.</span>
      <button type="button" onClick={() => setShowImages(true)}>Show images</button>
    </div>}
    <iframe ref={frame} title={title} className="em-html-frame" style={{ height }}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={doc} />
  </div>;
}
