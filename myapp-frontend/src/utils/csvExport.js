// Shared CSV export.
//
// Audit H-14 (2026-05-13): a cell whose first character is =, +, -, @, tab or
// carriage return is a FORMULA to Excel, not text. `=WEBSERVICE(...)` turns a
// downloaded report into an SSRF, `=HYPERLINK(...)` into an exfiltration link.
// Every operator-supplied string goes through `csvSafe` before it reaches a
// file, exactly as the server routes its exports through Helpers CsvSafe.

export function csvSafe(raw) {
  const s = String(raw ?? "");
  if (!s) return s;
  const first = s[0];
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    return "'" + s;
  }
  return s;
}

/** One CSV row: every cell escaped and quoted. */
export function csvRow(cells) {
  return cells.map((c) => `"${csvSafe(c).replaceAll('"', '""')}"`).join(",");
}

/**
 * Build a CSV from a header row plus data rows and hand it to the browser as a
 * download. Uses a BOM so Excel opens UTF-8 correctly — without it, a client
 * name with an accent or an Urdu character arrives as mojibake.
 */
export function downloadCsv(filename, header, rows) {
  const body = [csvRow(header), ...rows.map(csvRow)].join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
