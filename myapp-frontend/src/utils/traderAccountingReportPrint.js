import { brandAccountingReport } from "./accountingReportPrint";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const money = (n) => {
  const value = Number(n || 0);
  const formatted = Math.abs(value).toLocaleString("en-PK", { minimumFractionDigits:2, maximumFractionDigits:2 });
  return value < 0 ? `(${formatted})` : formatted;
};

export function buildTraderReportHtml(tab, data, company, title, period) {
  let head, rows = [], foot, notice = "";
  const line = (label, amount, kind = "") => ({ cells:[label, money(amount)], kind });
  const sections = (list) => (list || []).flatMap((s) => [line(s.name, s.total, "group"),
    ...(s.lines || []).map((l) => line(`${l.code ? l.code + " · " : ""}${l.name}`, l.amount, "account"))]);
  if (tab === "balance-sheet") {
    head = ["Account", "Amount"];
    rows = [line("Assets", data.totalAssets, "group"), ...sections(data.assets), line("Total assets", data.totalAssets, "total"),
      line("Liabilities", data.totalLiabilities, "group"), ...sections(data.liabilities), line("Total liabilities", data.totalLiabilities, "total"),
      line("Equity", data.totalEquity, "group"), ...sections(data.equity), line("Current-Year Earnings", data.currentEarnings, "account"),
      line("Total equity", data.totalEquity, "total")];
    foot = ["Total liabilities & equity", money(data.totalLiabilities + data.totalEquity)];
    notice = data.isBalanced ? "Balanced — assets equal liabilities plus equity."
      : `Does not balance. Assets ${money(data.totalAssets)} against liabilities plus equity ${money(data.totalLiabilities + data.totalEquity)}.`;
  } else if (tab === "profit-and-loss") {
    head = ["Account", "Amount"];
    rows = [line("Income", data.totalIncome, "group"), ...sections(data.income), line("Total income", data.totalIncome, "total"),
      line("Expenses", data.totalExpenses, "group"), ...sections(data.expenses), line("Total expenses", data.totalExpenses, "total")];
    foot = [data.netProfit >= 0 ? "Net profit" : "Net loss", money(Math.abs(data.netProfit))];
  } else if (tab === "aged-receivables" || tab === "aged-payables") {
    head = ["Party", "Docs", "Current", "1–30", "31–60", "61–90", "90+", "Total"];
    rows = (data.rows || []).map((r) => ({ cells:[r.name,r.openDocuments,...[r.current,r.days1To30,r.days31To60,r.days61To90,r.over90,r.total].map(money)] }));
    foot = ["Total", "", ...[data.current,data.days1To30,data.days31To60,data.days61To90,data.over90,data.total].map(money)];
  } else if (tab === "cash-book") {
    head = ["Account", "Opening", "Money in", "Money out", "Closing"];
    rows = (data.accounts || []).map((a) => ({ cells:[a.name,...[a.opening,a.moneyIn,a.moneyOut,a.closing].map(money)] }));
    foot = ["Total", ...[data.opening,data.moneyIn,data.moneyOut,data.closing].map(money)];
  } else if (tab === "expenses") {
    head = ["Account", "Group", "Amount", "Share"];
    rows = (data.rows || []).map((r) => ({ cells:[r.name,r.groupName,money(r.amount),`${Number(r.percent || 0).toFixed(1)}%`] }));
    foot = ["Total", "", money(data.total), "100.0%"];
  } else if (tab === "tax-control") {
    head = ["Tax", "Account", "Per ledger", "Per documents", "Difference"];
    rows = (data.rows || []).map((r) => ({ cells:[String(r.role || "").replace(/([a-z])([A-Z])/g,"$1 $2"),r.accountName,money(r.perLedger),money(r.perDocuments),
      r.reconciles ? "Agrees" : money(r.difference)] }));
    notice = data.allReconcile ? "Every tax account agrees with the documents behind it." : "A tax account disagrees with the documents. Resolve the difference before filing.";
  } else throw new Error("Unknown accounting report");
  const portrait = ["balance-sheet", "profit-and-loss", "expenses"].includes(tab);
  const cells = (values, tag) => values.map((value, i) => `<${tag} class="${i ? "num" : ""}">${esc(value)}</${tag}>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page {size:A4 ${portrait ? "portrait" : "landscape"};margin:12mm;}
    body{margin:0;font:11px Arial;color:#222}.co{font-size:22px;font-weight:bold}.ttl{font-size:18px;margin:12px 0 5px}
    .meta{margin-bottom:14px;color:#52606d}.notice{margin:10px 0}table{width:100%;border-collapse:collapse}
    th,td{padding:6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{font-size:10px}
    .num{text-align:right}.group td,.total td,tfoot td{font-weight:bold}.account td:first-child{padding-left:18px}
    .total td,tfoot td{border-top:2px solid #aaa}thead{display:table-header-group}tr{break-inside:avoid}
  </style></head><body><div class="co">${esc(company.name)}</div><h1 class="ttl">${esc(title)}</h1>
    <div class="meta">${esc(period)} · Source: general ledger</div>${notice ? `<div class="notice no-break">${esc(notice)}</div>` : ""}
    <table><thead><tr>${cells(head,"th")}</tr></thead><tbody>${rows.map((r) => `<tr class="${r.kind || ""}">${cells(r.cells,"td")}</tr>`).join("")}</tbody>
    ${foot ? `<tfoot><tr>${cells(foot,"td")}</tr></tfoot>` : ""}</table></body></html>`;
}

export async function buildTraderAccountingReport(tab, data, company, template, title, period) {
  return brandAccountingReport(buildTraderReportHtml(tab, data, company, title, period), company, template);
}
