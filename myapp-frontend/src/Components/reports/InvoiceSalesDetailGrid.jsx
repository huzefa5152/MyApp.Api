import useIsNarrow from "../../hooks/useIsNarrow";
import { fmtMoney } from "../ReportShell";
import { fbrTone, fmtDay, fmtQty, fmtRate, sumOf } from "../../utils/invoiceSalesDetail";
import "./InvoiceSalesDetailGrid.css";

/**
 * The Invoice Sales Detail grid.
 *
 * One row per bill LINE — the shape of the Excel the operator keeps — grouped
 * by bill: a bill's own fields (date, number, challan, buyer, NTN, address, FBR
 * status) print once, on its first line, its lines share a band, and a firmer
 * rule closes each bill. Twenty-one columns do not fit a screen, so the grid
 * scrolls inside its own box: the two header rows stay in view, the three Bill
 * columns stay frozen on the left and the totals row stays pinned at the foot.
 * A sticky header could not work against the page: `.dl-main` sets
 * `overflow-x`, which makes it a scroll container that never scrolls.
 *
 * Phones get one card per bill with its lines instead.
 */

// `bill`: printed on a bill's first line only. `frozen`: the left offset (the
// widths of the frozen columns before it) — it stays in view when the grid
// scrolls sideways. `group`: the header band above it; null = a column that is
// its own group and spans both header rows.
const COLUMNS = [
  { key: "date", label: "Date", group: "Bill", width: 104, bill: true, frozen: 0, className: "isd-nowrap", render: (r) => fmtDay(r.date) },
  { key: "invoiceNumber", label: "Inv No", group: "Bill", width: 64, bill: true, frozen: 104, className: "isd-inv" },
  { key: "deliveryChallanNumbers", label: "DC No", group: "Bill", width: 72, bill: true, frozen: 168, className: "isd-frozen-edge" },
  { key: "buyer", label: "Party Name", group: "Buyer", width: 200, bill: true, clamp: true, className: "isd-party" },
  { key: "buyerNtn", label: "NTN", group: "Buyer", width: 104, bill: true, mono: true },
  { key: "buyerAddress", label: "Address", group: "Buyer", width: 240, bill: true, clamp: true, muted: true },
  { key: "hsCode", label: "HS Code", group: "Item", width: 92, mono: true },
  { key: "description", label: "Description", group: "Item", width: 230, clamp: true },
  { key: "unit", label: "Unit", group: "Item", width: 76, muted: true },
  { key: "quantity", label: "Qty", group: "Item", width: 76, num: true, render: (r) => fmtQty(r.quantity) },
  { key: "rate", label: "Rate", group: "Item", width: 96, num: true, money: true },
  { key: "excludingTax", label: "Excl", group: "Sales tax", width: 110, num: true, money: true },
  { key: "taxRate", label: "Tax Rate", group: "Sales tax", width: 72, num: true, render: (r) => fmtRate(r.taxRate) },
  { key: "salesTax", label: "G. S. T", group: "Sales tax", width: 100, num: true, money: true },
  { key: "includingTax", label: "Incl", group: "Sales tax", width: 110, num: true, money: true },
  { key: "advanceTax", label: "236-G / 236-H", group: "Other taxes", width: 104, num: true, money: true, zeroBlank: true },
  { key: "furtherTax", label: "Further Tax", group: "Other taxes", width: 96, num: true, money: true, zeroBlank: true },
  { key: "total", label: "Total", group: null, width: 116, num: true, money: true, strong: true },
  { key: "fbrStatus", label: "Status", group: "FBR", width: 132, bill: true, chip: (r) => fbrTone(r.fbrStatus) },
  { key: "fbrInvoiceNumber", label: "FBR Invoice No", group: "FBR", width: 190, bill: true, mono: true },
  { key: "billStatus", label: "Bill Status", group: null, width: 100, bill: true, chip: (r) => (r.billStatus === "Cancelled" ? "bad" : null) },
];
const TABLE_WIDTH = COLUMNS.reduce((w, c) => w + c.width, 0);

// The header band above the columns; a column with no group spans both rows.
const GROUPS = COLUMNS.reduce((out, c, i) => {
  const last = out[out.length - 1];
  if (c.group && last?.label === c.group) last.span += 1;
  else out.push({ label: c.group || c.label, span: 1, solo: !c.group, first: c, index: i });
  return out;
}, []);
const GROUP_ENDS = new Set(GROUPS.map((g) => g.index + g.span - 1));

export default function InvoiceSalesDetailGrid({ report, bills, allBillCount, loading = false, emptyText }) {
  const narrow = useIsNarrow();
  if (!bills.length) return <div className="isd-state">{emptyText}</div>;
  return narrow
    ? <BillCards bills={bills} loading={loading} />
    : <BillTable report={report} bills={bills} allBillCount={allBillCount} loading={loading} />;
}

function BillTable({ report, bills, allBillCount, loading }) {
  const lineCount = report.rows.length;
  return (
    <div className={"isd-scroll" + (loading ? " isd-busy" : "")}>
      <table className="isd-table" style={{ width: TABLE_WIDTH }}>
        <caption className="isd-sr">Invoice sales detail: one row per bill line, grouped by bill</caption>
        <colgroup>
          {COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>
        <thead>
          <tr className="isd-groups">
            {GROUPS.map((g) => (
              <th
                key={g.label}
                colSpan={g.span}
                rowSpan={g.solo ? 2 : 1}
                scope="colgroup"
                className={cls(
                  g.solo ? "isd-solo" : "isd-group",
                  g.first.frozen === 0 && "isd-frozen isd-frozen-edge",
                  g.solo && g.first.num && "isd-num",
                  "isd-gend",
                )}
                style={g.first.frozen === 0 ? { left: 0 } : undefined}
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr className="isd-heads">
            {COLUMNS.map((c, i) => c.group && (
              <th
                key={c.key}
                scope="col"
                className={cls(c.num && "isd-num", c.frozen !== undefined && "isd-frozen", c.className === "isd-frozen-edge" && "isd-frozen-edge", GROUP_ENDS.has(i) && "isd-gend")}
                style={c.frozen !== undefined ? { left: c.frozen } : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bills.map((b, bi) => b.lines.map((r, li) => (
            <tr
              key={`${b.invoiceId}-${r.lineNumber}`}
              className={cls(
                "isd-row",
                bi % 2 === 1 && "isd-row--alt",
                li === b.lines.length - 1 && "isd-row--last",
                b.cancelled && "isd-row--cancelled",
              )}
            >
              {COLUMNS.map((c, i) => <Cell key={c.key} col={c} row={r} first={li === 0} groupEnd={GROUP_ENDS.has(i)} />)}
            </tr>
          )))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="isd-foot isd-frozen isd-frozen-edge" style={{ left: 0 }}>Total</td>
            <td colSpan={8} className="isd-foot isd-foot-count">
              {plural(allBillCount, "bill")} · {plural(lineCount, "line")}
            </td>
            <td className="isd-foot isd-num">{fmtMoney(report.excludingTax)}</td>
            <td className="isd-foot" />
            <td className="isd-foot isd-num">{fmtMoney(report.salesTax)}</td>
            <td className="isd-foot isd-num">{fmtMoney(sumOf(report.rows, "includingTax"))}</td>
            <td className="isd-foot isd-num">{fmtMoney(report.advanceTax)}</td>
            <td className="isd-foot isd-num">{fmtMoney(report.furtherTax)}</td>
            <td className="isd-foot isd-num isd-strong">{fmtMoney(report.total)}</td>
            <td colSpan={3} className="isd-foot" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Cell({ col, row, first, groupEnd }) {
  const className = cls(
    col.num && "isd-num",
    col.frozen !== undefined && "isd-frozen",
    col.className,
    col.strong && "isd-strong",
    col.mono && "isd-mono",
    col.muted && "isd-muted",
    groupEnd && "isd-gend",
  );
  const style = col.frozen !== undefined ? { left: col.frozen } : undefined;
  if (col.bill && !first) return <td className={className} style={style} />;

  const raw = row[col.key];
  let content;
  if (col.chip) {
    const tone = col.chip(row);
    content = tone ? <span className={`isd-chip isd-chip--${tone}`}>{raw}</span> : <span className="isd-muted">{raw}</span>;
  } else if (col.render) {
    content = col.render(row);
  } else if (col.money) {
    content = col.zeroBlank && !Number(raw) ? "" : fmtMoney(raw);
  } else {
    content = raw ?? "";
  }
  if (col.clamp && raw) {
    return <td className={className} style={style} title={String(raw)}><span className="isd-clamp">{content}</span></td>;
  }
  return <td className={className} style={style}>{content}</td>;
}

/** Phones: one card per bill — who and when on top, its lines, then the money. */
function BillCards({ bills, loading }) {
  return (
    <div className={"isd-cards" + (loading ? " isd-busy" : "")}>
      {bills.map((b) => {
        const f = b.first;
        const meta = [f.buyerNtn && `NTN ${f.buyerNtn}`, f.deliveryChallanNumbers && `DC ${f.deliveryChallanNumbers}`]
          .filter(Boolean).join(" · ");
        return (
          <article key={b.invoiceId} className={cls("isd-card", b.cancelled && "isd-card--cancelled")}>
            <header className="isd-card-top">
              <span className="isd-card-inv">Inv {f.invoiceNumber}</span>
              <span className="isd-card-date">{fmtDay(f.date)}</span>
              <span className={`isd-chip isd-chip--${fbrTone(f.fbrStatus)}`}>{f.fbrStatus}</span>
            </header>
            <div className="isd-card-party isd-clamp">{f.buyer}</div>
            {meta && <div className="isd-card-meta isd-mono">{meta}</div>}
            {f.buyerAddress && <div className="isd-card-addr isd-clamp">{f.buyerAddress}</div>}
            <ul className="isd-card-lines">
              {b.lines.map((r) => (
                <li key={r.lineNumber}>
                  <div className="isd-card-line-top">
                    <span className="isd-clamp">{r.description}</span>
                    <span className="isd-card-line-total">{fmtMoney(r.total)}</span>
                  </div>
                  <div className="isd-card-line-meta">
                    {[r.hsCode && `HS ${r.hsCode}`, `${fmtQty(r.quantity)} ${r.unit || ""} @ ${fmtMoney(r.rate)}`.trim(),
                      `${fmtRate(r.taxRate)} tax`].filter(Boolean).join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
            <div className="isd-card-amounts">
              <Figure label="Excl" value={b.totals.excl} />
              <Figure label="G. S. T" value={b.totals.gst} />
              {(b.totals.adv || b.totals.further) ? (
                <Figure label="236 / Further" value={b.totals.adv + b.totals.further} />
              ) : null}
              <Figure label="Total" value={b.totals.total} strong />
            </div>
            {(b.cancelled || f.fbrInvoiceNumber) && (
              <div className="isd-card-foot">
                {b.cancelled && <span className="isd-chip isd-chip--bad">Bill cancelled</span>}
                {f.fbrInvoiceNumber && <span className="isd-mono isd-muted">FBR {f.fbrInvoiceNumber}</span>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Figure({ label, value, strong = false }) {
  return (
    <div className="isd-figure">
      <span className="isd-figure-label">{label}</span>
      <span className={cls("isd-figure-value", strong && "isd-figure-value--strong")}>{fmtMoney(value)}</span>
    </div>
  );
}

const cls = (...names) => names.filter(Boolean).join(" ");
const plural = (n, word) => `${Number(n || 0).toLocaleString("en-PK")} ${word}${n === 1 ? "" : "s"}`;
