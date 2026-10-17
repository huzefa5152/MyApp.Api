// Same rule as the server CsvSafe (audit H-14): a leading = + - @ tab or CR
// makes Excel read the cell as a formula, so prefix it with a quote.
export function csvSafe(raw) {
  const s = String(raw ?? "");
  if (!s) return s;
  return "=+-@\t\r".includes(s[0]) ? "'" + s : s;
}
