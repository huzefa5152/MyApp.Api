import { renderRichTextHtml } from "../utils/richText";

// Renders item-description text with safe limited formatting — line breaks and
// <b>/<i>/<u>. Everything else is HTML-escaped, so this is not an XSS vector.
// Use anywhere a stored description is DISPLAYED (view modals, tables).
export default function RichText({ text, style, className }) {
  return (
    <span
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderRichTextHtml(text) }}
    />
  );
}
