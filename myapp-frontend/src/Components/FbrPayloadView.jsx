import { useMemo, useState } from "react";
import { MdCheckCircle, MdContentCopy } from "react-icons/md";

/**
 * Everything one bill sends to FBR, read straight from the payload the server
 * built: every header field, every field of every item, each tax summed, and
 * the JSON itself in an expandable block.
 *
 * Shared by View FBR (FbrPreviewDialog) and Preview All (BulkFbrPreviewDialog)
 * so the two cannot show different things. Nothing here is recomputed from the
 * bill: a figure on screen is a figure in the payload, or a plain sum of them.
 *
 * Colours come from the theme tokens, so it follows Classic and Workspace.
 *
 * Items are cards with an auto-fit field grid, not a table: seventeen fields
 * per item do not fit a table at any width, and the grid needs no breakpoint.
 */

const num = (v) => (typeof v === "number" ? v : Number(v) || 0);
const fmtNum = (n) =>
  num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Strip trailing zeros, same rule as the rest of the app.
const fmtQty = (n) => parseFloat(num(n).toFixed(12)).toString();

// What a line comes to: its value plus every tax on it, less discount. The
// payload's own totalValues is sent as 0 on this line, so it cannot be the total.
const lineAmount = (it) =>
  num(it.valueSalesExcludingST) +
  num(it.salesTaxApplicable) +
  num(it.furtherTax) +
  num(it.extraTax) +
  num(it.fedPayable) -
  num(it.discount);

// Every item field FBR receives, in the order the payload carries them.
// kind: "money" | "qty" | "text".
const ITEM_FIELDS = [
  ["hsCode", "HS code", "text"],
  ["productDescription", "Product description", "text"],
  ["saleType", "Sale type", "text"],
  ["rate", "Rate", "text"],
  ["uoM", "Unit of measure", "text"],
  ["quantity", "Quantity", "qty"],
  ["valueSalesExcludingST", "Value excl. sales tax", "money"],
  ["fixedNotifiedValueOrRetailPrice", "Fixed / notified value or retail price", "money"],
  ["salesTaxApplicable", "Sales tax", "money"],
  ["furtherTax", "Further tax", "money"],
  ["extraTax", "Extra tax", "money"],
  ["fedPayable", "FED payable", "money"],
  ["salesTaxWithheldAtSource", "Sales tax withheld at source", "money"],
  ["discount", "Discount", "money"],
  ["sroScheduleNo", "SRO / schedule no.", "text"],
  ["sroItemSerialNo", "SRO item serial no.", "text"],
  ["totalValues", "Total values (as sent)", "money"],
];

// The summed figures, in reading order. The last one is what the bill comes to.
const TOTAL_FIELDS = [
  ["valueSalesExcludingST", "Value excl. sales tax"],
  ["salesTaxApplicable", "Sales tax"],
  ["furtherTax", "Further tax"],
  ["extraTax", "Extra tax"],
  ["fedPayable", "FED payable"],
  ["salesTaxWithheldAtSource", "Withheld at source"],
  ["discount", "Discount"],
];

function Field({ label, children, strong }) {
  return (
    <div style={s.field}>
      <div style={s.fieldLabel}>{label}</div>
      <div style={{ ...s.fieldValue, ...(strong ? s.fieldStrong : null) }}>{children}</div>
    </div>
  );
}

// An empty field is sent empty; say so rather than leave a gap.
const blank = (
  <span style={{ color: "var(--k-faint)", fontStyle: "italic", fontWeight: 400 }}>blank</span>
);

function show(value, kind = "text") {
  if (value === "" || value === null || value === undefined) return blank;
  if (kind === "money") return fmtNum(value);
  if (kind === "qty") return fmtQty(value);
  return String(value);
}

export default function FbrPayloadView({ payload, itemCount, originalLineCount, url }) {
  const [copied, setCopied] = useState(false);
  const items = useMemo(() => payload?.items ?? [], [payload]);
  const json = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const totals = useMemo(() => {
    const t = { quantity: 0, amount: 0 };
    for (const [key] of TOTAL_FIELDS) t[key] = 0;
    for (const it of items) {
      t.quantity += num(it.quantity);
      t.amount += lineAmount(it);
      for (const [key] of TOTAL_FIELDS) t[key] += num(it[key]);
    }
    return t;
  }, [items]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the JSON is on screen to select */
    }
  };

  if (!payload) return null;
  const count = itemCount ?? items.length;

  return (
    <div style={s.wrap}>
      {/* What the bill comes to at FBR, tax by tax. */}
      <section>
        <div style={s.sectionTitle}>Totals sent to FBR</div>
        <div style={s.totalsGrid}>
          {TOTAL_FIELDS.map(([key, label]) => (
            <div key={key} style={s.totalCard}>
              <div style={s.totalLabel}>{label}</div>
              <div style={s.totalValue}>{fmtNum(totals[key])}</div>
            </div>
          ))}
          <div style={{ ...s.totalCard, ...s.totalCardGrand }}>
            <div style={{ ...s.totalLabel, color: "var(--k-blue)" }}>
              Total amount incl. all taxes
            </div>
            <div style={{ ...s.totalValue, color: "var(--k-blue)" }}>{fmtNum(totals.amount)}</div>
          </div>
        </div>
        <div style={s.note}>
          {count} FBR {count === 1 ? "item" : "items"}, total quantity {fmtQty(totals.quantity)}
          {originalLineCount != null && originalLineCount !== count && (
            <>
              {" "}
              (grouped by item type from {originalLineCount} bill{" "}
              {originalLineCount === 1 ? "line" : "lines"})
            </>
          )}
        </div>
      </section>

      {/* Header fields: every one the payload carries. */}
      <section>
        <div style={s.sectionTitle}>Invoice header</div>
        <div style={s.headerGrid}>
          <div style={s.panel}>
            <div style={s.panelTitle}>Seller</div>
            <Field label="Business name" strong>
              {show(payload.sellerBusinessName)}
            </Field>
            <Field label="NTN / CNIC">{show(payload.sellerNTNCNIC)}</Field>
            <Field label="Province">{show(payload.sellerProvince)}</Field>
            <Field label="Address">{show(payload.sellerAddress)}</Field>
          </div>
          <div style={s.panel}>
            <div style={s.panelTitle}>Buyer</div>
            <Field label="Business name" strong>
              {show(payload.buyerBusinessName)}
            </Field>
            <Field label="Registration type">{show(payload.buyerRegistrationType)}</Field>
            <Field label="NTN / CNIC">{show(payload.buyerNTNCNIC)}</Field>
            <Field label="Province">{show(payload.buyerProvince)}</Field>
            <Field label="Address">{show(payload.buyerAddress)}</Field>
          </div>
          <div style={s.panel}>
            <div style={s.panelTitle}>Document</div>
            <Field label="Invoice type" strong>
              {show(payload.invoiceType)}
            </Field>
            <Field label="Invoice date">{show(payload.invoiceDate)}</Field>
            <Field label="Reference invoice no.">{show(payload.invoiceRefNo)}</Field>
            {/* Only present in the payload when they apply. */}
            {payload.scenarioId != null && (
              <Field label="Scenario">{show(payload.scenarioId)}</Field>
            )}
            {payload.reason != null && <Field label="Reason">{show(payload.reason)}</Field>}
            {payload.reasonRemarks != null && (
              <Field label="Remarks">{show(payload.reasonRemarks)}</Field>
            )}
          </div>
        </div>
      </section>

      {/* Every field of every item. */}
      <section>
        <div style={s.sectionTitle}>Items ({count})</div>
        <div style={s.itemsList}>
          {items.map((it, idx) => (
            <div key={idx} style={s.itemCard}>
              <div style={s.itemHead}>
                <span style={s.itemIdx}>{idx + 1}</span>
                <span style={s.itemTitle}>
                  {it.hsCode || "No HS code"}
                  {it.saleType ? ` · ${it.saleType}` : ""}
                </span>
                <span style={s.itemTotal}>{fmtNum(lineAmount(it))}</span>
              </div>
              <div style={s.itemGrid}>
                {ITEM_FIELDS.map(([key, label, kind]) => (
                  <Field key={key} label={label} strong={key === "valueSalesExcludingST"}>
                    {show(it[key], kind)}
                  </Field>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* The payload itself, exactly as it would be posted. */}
      <details style={s.details}>
        <summary style={s.summary}>Actual payload sent to FBR (JSON)</summary>
        <div style={s.detailsBody}>
          {url && (
            <div style={s.note}>
              POST <code style={s.code}>{url}</code>
            </div>
          )}
          <button type="button" style={s.copyBtn} onClick={copyJson}>
            {copied ? (
              <>
                <MdCheckCircle size={16} /> Copied
              </>
            ) : (
              <>
                <MdContentCopy size={16} /> Copy JSON
              </>
            )}
          </button>
          <pre style={s.rawJson}>{json}</pre>
        </div>
      </details>
    </div>
  );
}

const s = {
  wrap: { display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 },
  sectionTitle: {
    fontSize: "0.74rem",
    fontWeight: 700,
    color: "var(--k-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: "0.45rem",
  },
  note: {
    fontSize: "0.8rem",
    color: "var(--k-muted)",
    marginTop: "0.45rem",
    overflowWrap: "anywhere",
  },

  totalsGrid: {
    display: "grid",
    gap: "0.5rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))",
  },
  totalCard: {
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
    background: "var(--k-surface)",
    padding: "0.55rem 0.7rem",
    minWidth: 0,
  },
  totalCardGrand: { background: "var(--k-surface-2)", border: "1px solid var(--k-blue)" },
  totalLabel: { fontSize: "0.72rem", fontWeight: 600, color: "var(--k-muted)" },
  totalValue: {
    fontSize: "1.02rem",
    fontWeight: 700,
    color: "var(--k-ink)",
    marginTop: 2,
    fontVariantNumeric: "tabular-nums",
    overflowWrap: "anywhere",
  },

  headerGrid: {
    display: "grid",
    gap: "0.6rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
  },
  panel: {
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
    background: "var(--k-surface)",
    padding: "0.65rem 0.8rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
    minWidth: 0,
  },
  panelTitle: { fontSize: "0.86rem", fontWeight: 700, color: "var(--k-blue)" },

  field: { minWidth: 0 },
  fieldLabel: { fontSize: "0.7rem", fontWeight: 600, color: "var(--k-muted)" },
  fieldValue: {
    fontSize: "0.86rem",
    color: "var(--k-ink)",
    marginTop: 1,
    overflowWrap: "anywhere",
    fontVariantNumeric: "tabular-nums",
  },
  fieldStrong: { fontWeight: 700 },

  itemsList: { display: "flex", flexDirection: "column", gap: "0.6rem" },
  itemCard: {
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
    background: "var(--k-surface)",
    overflow: "hidden",
  },
  itemHead: {
    display: "flex",
    alignItems: "center",
    gap: "0.55rem",
    flexWrap: "wrap",
    padding: "0.5rem 0.8rem",
    background: "var(--k-surface-2)",
    borderBottom: "1px solid var(--k-line)",
  },
  itemIdx: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: 999,
    background: "var(--k-blue)",
    color: "#fff",
    fontSize: "0.74rem",
    fontWeight: 700,
    flexShrink: 0,
  },
  itemTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: "0.88rem",
    fontWeight: 700,
    color: "var(--k-ink)",
    overflowWrap: "anywhere",
  },
  itemTotal: {
    fontSize: "0.92rem",
    fontWeight: 700,
    color: "var(--k-blue)",
    fontVariantNumeric: "tabular-nums",
  },
  itemGrid: {
    display: "grid",
    gap: "0.6rem 0.9rem",
    padding: "0.7rem 0.8rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
  },

  details: {
    border: "1px solid var(--k-line)",
    borderRadius: "var(--k-radius)",
    background: "var(--k-surface)",
  },
  summary: {
    cursor: "pointer",
    padding: "0.8rem 0.9rem",
    minHeight: 44,
    boxSizing: "border-box",
    fontSize: "0.88rem",
    fontWeight: 700,
    color: "var(--k-blue)",
  },
  detailsBody: { padding: "0 0.9rem 0.9rem", minWidth: 0 },
  copyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    minHeight: 44,
    padding: "0 0.9rem",
    margin: "0.5rem 0 0",
    background: "var(--k-surface)",
    color: "var(--k-blue)",
    border: "1px solid var(--k-blue)",
    borderRadius: "var(--k-radius)",
    fontSize: "0.84rem",
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "none",
  },
  rawJson: {
    margin: "0.6rem 0 0",
    padding: "0.75rem 0.9rem",
    background: "#0a1628",
    color: "var(--k-success-bg)",
    border: "1px solid #1a2332",
    borderRadius: "var(--k-radius)",
    fontSize: "0.76rem",
    lineHeight: 1.45,
    maxHeight: 420,
    overflow: "auto",
    whiteSpace: "pre",
  },
  code: {
    background: "rgba(13,71,161,0.08)",
    padding: "0.05rem 0.35rem",
    borderRadius: 4,
    fontSize: "0.78rem",
    fontFamily: "monospace",
    wordBreak: "break-all",
  },
};
