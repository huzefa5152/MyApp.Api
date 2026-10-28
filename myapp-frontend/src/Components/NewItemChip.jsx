import { useState } from "react";
import { createPortal } from "react-dom";
import { MdFiberNew, MdInventory2, MdWarningAmber } from "react-icons/md";
import ItemTypeForm from "./ItemTypeForm";
import { usePermissions } from "../contexts/PermissionsContext";
import { colors } from "../theme";

/**
 * What an invoice line shows under its item picker (importer, 2026-10-28):
 *
 *  - a pending NEW item (an FBR HS code with no catalog item yet): a chip
 *    saying it is made when the invoice is saved, and its name, editable;
 *  - "No stock" when the line sells more than is on hand (lineStock). On a
 *    hard-block company the invoice cannot be saved, so the line says so and,
 *    for someone who may make items AND record opening stock, offers "Add item
 *    and record stock": the catalog form opens prefilled, saves the item and
 *    its opening stock now, and the line switches to that catalog item.
 *
 * The server's stock guard is never bypassed: this only says it in advance.
 */
export default function NewItemChip({ pending, onRename, stock, quantity, uom, companyId, fbrOn = true, onStocked }) {
  const { has } = usePermissions();
  const [recording, setRecording] = useState(false);
  const canRecord = has("itemtypes.manage.create") && has("stock.opening.manage");
  if (!pending && !stock?.noStock) return null;

  return (
    <div style={s.wrap}>
      {pending && (
        <>
          <span style={s.chip} title="This item is added to your catalog when you save the invoice. Nothing is saved before that.">
            <MdFiberNew size={14} aria-hidden="true" /> New item — created when you save
          </span>
          <label style={s.nameLabel}>
            Item name
            <input
              style={s.nameInput}
              value={pending.name}
              maxLength={100}
              onChange={(e) => onRename?.(e.target.value)}
              aria-label="New item name"
            />
          </label>
        </>
      )}
      {stock?.noStock && (
        <div style={stock.blocksSave ? s.block : s.warn} role={stock.blocksSave ? "alert" : undefined}>
          <MdWarningAmber size={15} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
          <span>
            <b>No stock</b>
            {stock.onHand != null && ` (on hand ${Number(stock.onHand).toLocaleString("en-PK")})`}
            {stock.blocksSave
              ? " — this invoice cannot be saved until stock is recorded."
              : " — the invoice saves, and on-hand goes below zero."}
            {stock.blocksSave && !(pending && canRecord) &&
              " Someone who can add items and enter opening stock can record it."}
          </span>
        </div>
      )}
      {pending && stock?.blocksSave && canRecord && (
        <button type="button" style={s.recordBtn} onClick={() => setRecording(true)}
                title="Add this item to your catalog now and enter its opening stock, then sell it on this invoice.">
          <MdInventory2 size={15} aria-hidden="true" /> Add item and record stock
        </button>
      )}
      {recording && createPortal(
        <ItemTypeForm
          companyId={companyId}
          fbrOn={fbrOn}
          prefill={{ ...pending, uom: uom || pending.uom || "", openingQuantity: quantity || "" }}
          onClose={() => setRecording(false)}
          onSaved={(saved, extra) => {
            setRecording(false);
            if (saved) onStocked?.({ ...saved, availableQty: extra?.openingQuantity ?? saved.availableQty ?? 0 });
          }}
        />,
        document.body,
      )}
    </div>
  );
}

const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 6, marginTop: 6 },
  chip: {
    display: "inline-flex", alignItems: "center", gap: 4, alignSelf: "flex-start",
    padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700,
    background: colors.infoSoft, color: colors.infoInk, border: `1px solid ${colors.infoLine}`,
  },
  nameLabel: { display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 600, color: colors.textSecondary },
  nameInput: {
    minHeight: 44, padding: "0.35rem 0.5rem", borderRadius: 6, fontSize: "0.82rem",
    border: `1px solid ${colors.inputBorder}`, background: colors.white, color: colors.textPrimary,
  },
  warn: {
    display: "flex", gap: 6, padding: "6px 8px", borderRadius: 6, fontSize: "0.74rem", lineHeight: 1.35,
    background: colors.cautionSoft, color: colors.cautionInk, border: `1px solid ${colors.cautionLine}`,
  },
  block: {
    display: "flex", gap: 6, padding: "6px 8px", borderRadius: 6, fontSize: "0.74rem", lineHeight: 1.35,
    background: colors.errorSoft, color: colors.errorInk, border: `1px solid ${colors.errorLine}`,
  },
  recordBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "flex-start",
    minHeight: 44, padding: "0 0.85rem", borderRadius: 8, fontSize: "0.8rem", fontWeight: 700,
    background: colors.white, color: colors.blue, border: `1px solid ${colors.blue}`, cursor: "pointer", boxShadow: "none",
  },
};
