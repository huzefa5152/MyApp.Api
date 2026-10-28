import {
  MdEdit, MdPrint, MdVisibility, MdPictureAsPdf, MdGridOn, MdCheckCircle, MdCloudUpload,
  MdPreview, MdBlock, MdRestore, MdPayments, MdCopyAll, MdLocalShipping, MdUndo, MdPostAdd,
  MdCancel, MdDelete,
} from "react-icons/md";
import CardActions from "./CardActions";
import { colors } from "../theme";

/**
 * No `data-label`: CardActions adds that text beside a menu item's icon, and
 * these buttons already carry their label (it doubled: "View View").
 *
 * Renders utils/invoiceActions.js's list for one invoice -- on the card and
 * in the table alike, so the two cannot drift. Every action is an icon AND a
 * short label with a one-line tooltip; primary ones sit inline, the rest go
 * into CardActions' "More actions" menu (the only icon-only button). Danger
 * actions are red and last.
 */
const ICONS = {
  edit: MdEdit, print: MdPrint, view: MdVisibility, pdf: MdPictureAsPdf, excel: MdGridOn,
  validate: MdCheckCircle, submit: MdCloudUpload, preview: MdPreview, exclude: MdBlock, reset: MdRestore,
  receipt: MdPayments, copy: MdCopyAll, challan: MdLocalShipping, creditNote: MdUndo, correct: MdPostAdd,
  void: MdCancel, delete: MdDelete,
};

export default function InvoiceActionBar({ inv, actions, onAction, busy, compact = false, style }) {
  // A table row has room for two inline actions; the rest go into "More".
  let shown = 0;
  const list = actions.map((a) => {
    const primary = a.primary && (!compact || shown < 2);
    if (primary) shown += 1;
    return { ...a, primary };
  });
  return (
    <CardActions nowrap={compact} label={`More actions for invoice ${inv.invoiceNumber}`} style={style}>
      {list.map((a) => {
        const Icon = a.key === "exclude" && inv.isFbrExcluded ? MdRestore : ICONS[a.key];
        const working = busy === a.key;
        return (
          <button
            key={a.key}
            type="button"
            data-primary={a.primary || undefined}
            disabled={a.disabled || !!busy}
            title={a.title}
            onClick={() => onAction(a.key, inv)}
            style={{ ...btn(a, compact), ...(a.disabled ? disabledStyle : null) }}
          >
            {working ? <span className="btn-spinner" /> : Icon ? <Icon size={15} aria-hidden="true" style={{ flexShrink: 0 }} /> : null}
            <span>{a.label}</span>
          </button>
        );
      })}
    </CardActions>
  );
}

const TONES = {
  primary: { bg: colors.infoSoft, fg: colors.infoInk, line: colors.infoLine },
  fbr: { bg: colors.tealSoft, fg: colors.tealDark, line: colors.tealLine },
  money: { bg: colors.white, fg: colors.textPrimary, line: colors.inputBorder },
  danger: { bg: colors.errorSoft, fg: colors.errorInk, line: colors.errorLine },
};

const btn = (a, compact) => {
  const t = TONES[a.danger ? "danger" : a.group] || TONES.money;
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
    minHeight: compact ? 32 : 44, padding: compact ? "0 0.55rem" : "0 0.75rem",
    borderRadius: 8, fontSize: compact ? "0.74rem" : "0.8rem", fontWeight: 600,
    background: t.bg, color: t.fg, border: `1px solid ${t.line}`,
    // Inline buttons keep one line; in the "More" menu a long label wraps
    // instead of pushing the menu sideways (and squeezing its icon to nothing).
    boxShadow: "none", cursor: "pointer", whiteSpace: a.primary ? "nowrap" : "normal",
  };
};
const disabledStyle = { opacity: 0.5, cursor: "not-allowed" };

/** The one FBR status chip, coloured from theme.js. */
export function InvoiceFbrChip({ chip }) {
  if (!chip) return null;
  const t = CHIP_TONES[chip.tone] || CHIP_TONES.neutral;
  return (
    <span title={chip.title} style={{
      display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap",
      padding: "2px 9px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700,
      background: t.bg, color: t.fg, border: `1px solid ${t.line}`,
    }}>
      {chip.label}
      {chip.irn && <span style={{ fontFamily: "monospace", fontWeight: 600, wordBreak: "break-all" }}>· {chip.irn}</span>}
    </span>
  );
}

const CHIP_TONES = {
  success: { bg: colors.successSoft, fg: colors.successInk, line: colors.successLine },
  info: { bg: colors.infoSoft, fg: colors.infoInk, line: colors.infoLine },
  warn: { bg: colors.warnSoft, fg: colors.warnInk, line: colors.warnLine },
  caution: { bg: colors.cautionSoft, fg: colors.cautionInk, line: colors.cautionLine },
  danger: { bg: colors.errorSoft, fg: colors.errorInk, line: colors.errorLine },
  neutral: { bg: colors.neutralSoft, fg: colors.neutralInk, line: colors.neutralLine },
};
