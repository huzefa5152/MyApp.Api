import { useEffect, useRef } from "react";
import { MdClose } from "react-icons/md";
import RichText from "../Components/RichText";
import AttachmentManager from "../Components/AttachmentManager";
import ChallanPrivateCosts from "../Components/ChallanPrivateCosts";
import { Btn, IconBtn, StatusPill } from "./primitives";
import "./ui2.css";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");
const statusLabel = (s) => (s === "Invoiced" ? "Billed" : s);

/**
 * Read-only challan view in the redesigned theme. Shows every field the old ChallanModal showed
 * (client, site, delivery date, PO number / date, indent, status, items, private costs, notes,
 * attachments) and adds the sales order number when there is one. Presentation only.
 */
export default function ChallanDetailV2({ challan, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!challan) return undefined;
    const prev = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [challan, onClose]);

  if (!challan) return null;
  const items = challan.items || [];
  const facts = [
    ["Client", challan.clientName || "—"],
    challan.site && ["Site", challan.site],
    ["Delivery date", fmtDate(challan.deliveryDate)],
    ["PO number", challan.poNumber || "—"],
    challan.poDate && ["PO date", fmtDate(challan.poDate)],
    challan.indentNo && ["Indent no", challan.indentNo],
    challan.salesOrderNumber && ["Sales order", `#${challan.salesOrderNumber}`],
  ].filter(Boolean);

  // Backdrop click does nothing, like every popup in the app: it closes with the X, Close or Escape.
  return (
    <div className="u2-dialog-backdrop">
      <div className="u2-dialog" ref={closeRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="u2-challan-title">
        <header className="u2-dialog__head">
          <h2 id="u2-challan-title" className="u2-dialog__title">
            Challan <span className="u2-dc u2-dc--static">{challan.challanNumber}</span>
            <StatusPill status={challan.status} label={statusLabel(challan.status)} />
          </h2>
          <IconBtn large label="Close" icon={MdClose} size={18} onClick={onClose} />
        </header>

        <div className="u2-dialog__body">
          <dl className="u2-facts">
            {facts.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>

          <section aria-label="Items">
            <h3 className="u2-dialog__h">Items <span className="u2-bar__count">{items.length}</span></h3>
            <div className="u2-grid u2-grid--standalone">
              <div className="u2-grid__scroll" style={{ maxHeight: 300 }}>
                <table className="u2-table u2-table--compact">
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: 40 }}>#</th>
                      <th scope="col" style={{ width: 130 }}>Item type</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="is-right" style={{ width: 80 }}>Qty</th>
                      <th scope="col" style={{ width: 90 }}>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="u2-cell-muted">{idx + 1}</td>
                        <td>{item.itemTypeName || "—"}</td>
                        <td style={{ height: "auto", padding: "0.5rem 0.75rem" }}><RichText text={item.description} /></td>
                        <td className="is-right" style={{ fontWeight: 700 }}>{item.quantity}</td>
                        <td>{item.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <ChallanPrivateCosts items={items} readOnly />

          {challan.notes && (
            <section aria-label="Notes">
              <h3 className="u2-dialog__h">Notes</h3>
              <div className="u2-notes"><RichText text={challan.notes} /></div>
            </section>
          )}

          <AttachmentManager companyId={challan.companyId} entityType="DeliveryChallan" entityId={challan.id} mode="view" />
        </div>

        <footer className="u2-dialog__foot">
          <Btn variant="secondary" onClick={onClose}>Close</Btn>
        </footer>
      </div>
    </div>
  );
}
