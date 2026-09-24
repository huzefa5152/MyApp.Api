import { useEffect, useMemo, useState } from "react";
import { MdErrorOutline } from "react-icons/md";
import HsCodeAutocomplete from "../HsCodeAutocomplete";
import { getItemTypesPaged } from "../../api/itemTypeApi";
import { billColors } from "../bill/billTheme";
import { FIELDS, lineProblems, messagesFor, computeCosting, moneyText, cleanHsCode } from "../../utils/gdCostingEntry";

/**
 * One GD line -- the same form for typing a GD and for fixing a line in the
 * review, so a line looks the same wherever it is being corrected.
 *
 * Red messages come from two places: this screen's instant copy of the rules
 * (utils/gdCostingEntry.lineProblems), shown under a box once it has been used
 * or once `showAll` is set (the operator pressed Add or Check); and the
 * server's own `serverProblems`, which always show -- they are the ones that
 * stop the import. A box stays quiet until it has been touched, so a fresh
 * blank line is not a wall of red.
 */

const COMMON_UNITS = ["Pcs", "Nos", "Kg", "Mtr", "Ltr", "Set", "Pair", "Dozen", "Sq.M", "Ft", "Bag", "Pack"];

const grid = {
  display: "grid", gap: "0.7rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))",
};

const inputStyle = (bad) => ({
  width: "100%", padding: "0.55rem 0.65rem", borderRadius: 8, boxSizing: "border-box",
  border: `1px solid ${bad ? billColors.danger : billColors.inputBorder}`,
  background: bad ? billColors.dangerLight : billColors.inputBg,
  color: billColors.textPrimary, fontSize: 14, minHeight: 44,
});

function Section({ title, children, note }) {
  return (
    <fieldset style={{ border: "none", margin: "0 0 0.9rem", padding: 0, minWidth: 0 }}>
      <legend style={{
        padding: 0, marginBottom: "0.45rem", fontSize: 11.5, fontWeight: 800,
        textTransform: "uppercase", letterSpacing: "0.06em", color: billColors.textSecondary,
      }}>{title}</legend>
      {children}
      {note}
    </fieldset>
  );
}

function ErrorText({ messages }) {
  if (!messages?.length) return null;
  return messages.map((m, i) => (
    <div key={i} role="alert" style={{
      display: "flex", gap: 4, alignItems: "flex-start", marginTop: 4,
      fontSize: 12, lineHeight: 1.4, color: billColors.danger, fontWeight: 600,
    }}>
      <MdErrorOutline size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{m}</span>
    </div>
  ));
}

function Field({ id, label, required, hint, hintTone, errors, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 13, color: billColors.textSecondary, marginBottom: 4 }}>
        {label}
        {required && <span aria-hidden="true" style={{ color: billColors.danger, marginLeft: 3 }}>*</span>}
        {required && <span style={srOnly}> (required)</span>}
      </label>
      {children}
      <ErrorText messages={errors} />
      {hint && !errors?.length && (
        <div style={{ marginTop: 3, fontSize: 11.5, lineHeight: 1.45, color: hintTone || billColors.textSecondary }}>{hint}</div>
      )}
    </div>
  );
}

const srOnly = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
};

function Stat({ label, value, strong }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: billColors.textSecondary }}>{label}</div>
      <div style={{ fontSize: strong ? 16 : 14.5, fontWeight: strong ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

export default function GdLineEditor({
  companyId, line, onChange, serverProblems = [], showAll = false, disabled = false, idPrefix = "gdl",
}) {
  const [touched, setTouched] = useState({});
  const touch = (field) => () => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  const set = (key) => (e) => onChange({ [key]: e.target.value });

  const clientProblems = useMemo(() => lineProblems(line), [line]);
  const errorsFor = (field) => {
    const own = showAll || touched[field] ? messagesFor(clientProblems, field) : [];
    const server = messagesFor(serverProblems, field);
    return [...new Set([...own, ...server])];
  };
  const computed = useMemo(() => computeCosting(line), [line]);

  // What this HS code will land on, said while typing -- a HINT: the server
  // decides the match (and whether it is by lot, code or name) at Check.
  const [hsMatches, setHsMatches] = useState(null);
  const hs = cleanHsCode(line.hsCode);
  useEffect(() => {
    if (!companyId || hs.length < 4) { setHsMatches(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(() => {
      getItemTypesPaged(companyId, { search: hs, pageSize: 50 })
        .then(({ data }) => {
          if (cancelled) return;
          // An un-adopted HS-tariff placeholder is FBR's reference row, not an
          // item on anyone's books -- counting it said "2 items share this
          // code" for a code the company holds exactly one item under.
          setHsMatches((data?.items || []).filter((i) =>
            cleanHsCode(i.hsCode) === hs && !(i.isAutoGenerated && !i.isFavorite)));
        })
        .catch(() => { if (!cancelled) setHsMatches(null); });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [companyId, hs]);

  const hsHint = (() => {
    if (!hs || hsMatches === null) return { text: "The code decides which item on your books these goods add to." };
    if (hsMatches.length === 0)
      return { text: "Nothing on your books under this code: it will come in as a new item." };
    if (hsMatches.length === 1)
      return {
        text: `Adds to ${hsMatches[0].name}${hsMatches[0].uom ? ` (kept in ${hsMatches[0].uom})` : ""}.`,
        tone: billColors.success,
      };
    return {
      text: `${hsMatches.length} items share this code. The one named like this line is used; otherwise you choose in the review.`,
      tone: billColors.warn,
    };
  })();
  const itemUnit = hsMatches?.length === 1 ? hsMatches[0].uom : null;

  const topServer = (serverProblems || []).filter((p) => p.field === FIELDS.item).map((p) => p.message);
  const id = (f) => `${idPrefix}-${f}`;
  const numProps = (field) => ({
    id: id(field), type: "number", inputMode: "decimal", step: "any",
    value: line[field] ?? "", onChange: set(field), onBlur: touch(field), disabled,
  });

  return (
    <div>
      <ErrorText messages={topServer} />

      <Section title="The GD">
        <div style={grid}>
          <Field id={id("gdNumber")} label="GD number" required errors={errorsFor(FIELDS.gdNumber)}
            hint="Shared by every line of this declaration.">
            <input id={id("gdNumber")} type="text" style={inputStyle(errorsFor(FIELDS.gdNumber).length)}
              placeholder="e.g. KAPW-HC-8876" value={line.gdNumber} onChange={set("gdNumber")}
              onBlur={touch("gdNumber")} disabled={disabled} autoComplete="off" />
          </Field>
          <Field id={id("gdDate")} label="GD date" required errors={errorsFor(FIELDS.gdDate)}
            hint="The stock, its journal entry and its claim month are all dated by this.">
            <input id={id("gdDate")} type="date" style={inputStyle(errorsFor(FIELDS.gdDate).length)}
              value={line.gdDate} onChange={set("gdDate")} onBlur={touch("gdDate")} disabled={disabled} />
          </Field>
        </div>
      </Section>

      <Section title="The goods">
        <div style={grid}>
          <Field id={id("description")} label="Item name" required errors={errorsFor(FIELDS.description)}
            hint="As the GD words it. A new item is created under this name.">
            <input id={id("description")} type="text" style={inputStyle(errorsFor(FIELDS.description).length)}
              placeholder="e.g. Screw Driver" value={line.description} onChange={set("description")}
              onBlur={touch("description")} disabled={disabled} />
          </Field>
          <Field id={id("hsCode")} label="HS code" required errors={errorsFor(FIELDS.hsCode)}
            hint={hsHint.text} hintTone={hsHint.tone}>
            <div onBlur={touch("hsCode")}>
              <HsCodeAutocomplete companyId={companyId} value={line.hsCode}
                style={inputStyle(errorsFor(FIELDS.hsCode).length)}
                onChange={(v) => onChange({ hsCode: v })}
                placeholder="Type the code, or a product word…" />
            </div>
          </Field>
          <Field id={id("quantity")} label="Quantity" required errors={errorsFor(FIELDS.quantity)}>
            <input {...numProps("quantity")} min="0" style={inputStyle(errorsFor(FIELDS.quantity).length)} />
          </Field>
          <Field id={id("unit")} label="Unit" required errors={errorsFor(FIELDS.unit)}
            hint={itemUnit ? `That item is kept in ${itemUnit}: use the same unit.` : "Pcs, Kg, Mtr… Carries over to the next line."}
            hintTone={itemUnit ? billColors.blue : undefined}>
            <input id={id("unit")} type="text" list={id("units")} style={inputStyle(errorsFor(FIELDS.unit).length)}
              placeholder="e.g. Pcs" value={line.unit} onChange={set("unit")} onBlur={touch("unit")}
              disabled={disabled} autoComplete="off" />
            <datalist id={id("units")}>
              {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
            </datalist>
          </Field>
        </div>
      </Section>

      <Section title="Cost, from the GD" note={<ErrorText messages={errorsFor(FIELDS.amounts)} />}>
        <div style={grid}>
          <Field id={id("assessedValue")} label="Assessed value" required errors={errorsFor(FIELDS.assessedValue)}
            hint="Assessed value plus the three duties is the landed cost.">
            <input {...numProps("assessedValue")} min="0" style={inputStyle(errorsFor(FIELDS.assessedValue).length)} />
          </Field>
          <Field id={id("customsDuty")} label="Customs duty">
            <input {...numProps("customsDuty")} min="0" style={inputStyle(false)} onBlur={touch(FIELDS.amounts)} />
          </Field>
          <Field id={id("acd")} label="ACD">
            <input {...numProps("acd")} min="0" style={inputStyle(false)} onBlur={touch(FIELDS.amounts)} />
          </Field>
          <Field id={id("regulatoryDuty")} label="Regulatory duty">
            <input {...numProps("regulatoryDuty")} min="0" style={inputStyle(false)} onBlur={touch(FIELDS.amounts)} />
          </Field>
          <Field id={id("others")} label="Other charges" hint="Not part of the cost; added before income tax.">
            <input {...numProps("others")} min="0" style={inputStyle(false)} onBlur={touch(FIELDS.amounts)} />
          </Field>
        </div>
      </Section>

      <Section title="Rates (%)" note={<ErrorText messages={errorsFor(FIELDS.rates)} />}>
        <div style={grid}>
          <Field id={id("salesTaxRate")} label="Sales tax" hint="18 for ordinary goods, 25 for SRO 297 goods. It stays with the item for billing.">
            <input {...numProps("salesTaxRate")} min="0" style={inputStyle(false)} onBlur={touch(FIELDS.rates)} />
          </Field>
          <Field id={id("astRate")} label="Additional sales tax">
            <input {...numProps("astRate")} min="0" style={inputStyle(false)} onBlur={touch(FIELDS.rates)} />
          </Field>
          <Field id={id("incomeTaxRate")} label="Income tax">
            <input {...numProps("incomeTaxRate")} min="0" style={inputStyle(false)} onBlur={touch(FIELDS.rates)} />
          </Field>
        </div>
      </Section>

      <Section title="Selling (optional)">
        <div style={grid}>
          <Field id={id("addOnProfit")} label="Add-on profit" errors={[]}>
            <input {...numProps("addOnProfit")} min="0" style={inputStyle(false)} onBlur={touch(FIELDS.amounts)} />
          </Field>
          <Field id={id("sellingValue")} label="Selling value, if stated" errors={errorsFor(FIELDS.sellingValue)}
            hint="Leave blank and the costing works it out.">
            <input {...numProps("sellingValue")} min="0" style={inputStyle(errorsFor(FIELDS.sellingValue).length)}
              placeholder={moneyText(computed.sellingValue)} />
          </Field>
        </div>
      </Section>

      <div style={{
        ...grid, gridTemplateColumns: "repeat(auto-fit, minmax(min(130px, 100%), 1fr))",
        padding: "0.65rem 0.8rem", borderRadius: 9,
        background: billColors.blueSoft, border: `1px solid ${billColors.cardBorder}`,
      }}>
        <Stat label="Landed cost" value={moneyText(computed.cost)} strong />
        <Stat label="Sales tax" value={moneyText(computed.salesTax)} />
        <Stat label="AST" value={moneyText(computed.ast)} />
        <Stat label="Income tax" value={moneyText(computed.incomeTax)} />
        <Stat label="Selling value" value={moneyText(line.sellingValue !== "" && line.sellingValue != null ? Number(line.sellingValue) : computed.sellingValue)} strong />
      </div>
      <p style={{ margin: "0.35rem 0 0", fontSize: 11.5, color: billColors.textSecondary }}>
        Worked out as you type. Check re-does it on the server before anything is saved.
      </p>
    </div>
  );
}
