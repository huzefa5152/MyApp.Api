import { useEffect, useMemo, useState } from "react";
import { formStyles, modalSizes, colors } from "../theme";
import { getPendingChallansByCompany } from "../api/challanApi";
import { linkChallanToInvoice, createChallanForInvoice } from "../api/invoiceApi";

/** Compare descriptions the way an operator would: case and spacing are noise. */
const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * How much of the bill a challan accounts for. A challan carrying the same
 * products is almost certainly the delivery behind this bill; one with nothing
 * in common almost certainly is not. Counted over the BILL's lines, so "3 of 3"
 * means the whole bill is covered.
 */
function itemOverlap(invoice, challan) {
  const billLines = (invoice.items || []).map((i) => norm(i.description)).filter(Boolean);
  const dcLines = new Set((challan.items || []).map((i) => norm(i.description)).filter(Boolean));
  if (billLines.length === 0 || dcLines.size === 0) return { matched: 0, total: billLines.length };
  return { matched: billLines.filter((d) => dcLines.has(d)).length, total: billLines.length };
}

/**
 * Give a standalone bill a delivery challan — either one that already exists,
 * or a new one raised from the bill's own lines.
 *
 * What the list offers is deliberately narrow. A challan that is already billed
 * or cancelled is NOT shown: it cannot be attached, and listing it only to
 * refuse it wastes the operator's time. Another buyer's challan is not shown
 * either — the two documents would then claim goods went somewhere they did
 * not. What IS shown is ranked by how much of the bill each challan accounts
 * for, because that is the question the operator is actually answering.
 *
 * Searching steps outside that set on purpose: someone hunting for a specific
 * number deserves to be told WHY it is not there rather than shown an empty
 * list.
 */
export default function LinkChallanModal({ invoice, onClose, onDone, canCreateChallan = true }) {
  const [challans, setChallans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getPendingChallansByCompany(invoice.companyId);
        if (alive) setChallans(res.data || []);
      } catch {
        if (alive) setError("Could not load delivery challans. Close and try again.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [invoice.companyId]);

  const q = search.trim().toLowerCase();

  const matchesSearch = (c) => !q
    || String(c.challanNumber).includes(q)
    || (c.poNumber || "").toLowerCase().includes(q)
    || (c.items || []).some((i) => norm(i.description).includes(q));

  // Attachable: this buyer's challans, not already billed, not cancelled. The
  // pending feed already leaves billed and cancelled ones out; the tests are
  // repeated here so the rule is stated where it is relied on.
  const attachable = useMemo(() => challans
    .filter((c) => c.clientId === invoice.clientId && !c.invoiceId && c.status !== "Cancelled")
    .filter(matchesSearch)
    .map((c) => ({ ...c, overlap: itemOverlap(invoice, c) }))
    .sort((a, b) => (b.overlap.matched - a.overlap.matched) || (b.challanNumber - a.challanNumber)),
    [challans, invoice, q]);

  const likely = attachable.filter((c) => c.overlap.matched > 0);
  const others = attachable.filter((c) => c.overlap.matched === 0);

  // Only while searching: say why a challan the operator went looking for is
  // not on the list. Silence here reads as a broken search.
  const blocked = useMemo(() => {
    if (!q) return [];
    return challans
      .filter(matchesSearch)
      .filter((c) => c.clientId !== invoice.clientId || c.invoiceId || c.status === "Cancelled")
      .map((c) => ({
        ...c,
        reason: c.invoiceId
          ? `Already billed on Bill #${c.invoiceNumber ?? c.invoiceId}`
          : c.status === "Cancelled"
            ? "Cancelled"
            : `Delivered to ${c.clientName || "another buyer"} — a bill can only take its own buyer's challans`,
      }))
      .sort((a, b) => b.challanNumber - a.challanNumber);
  }, [challans, invoice, q]);

  const run = async (fn, failMessage) => {
    setBusy(true);
    setError("");
    try {
      const res = await fn();
      onDone?.(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || failMessage);
      setBusy(false);
    }
  };

  const groupLabel = (text) => (
    <div style={{
      fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.04em", color: colors.textSecondary, margin: "0.9rem 0 0.4rem",
    }}>
      {text}
    </div>
  );

  const challanCard = (c) => (
    <button
      key={c.id}
      disabled={busy}
      onClick={() => run(
        () => linkChallanToInvoice(invoice.id, c.id),
        `Could not attach challan #${c.challanNumber} to this bill.`)}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "0.75rem", flexWrap: "wrap", textAlign: "left",
        width: "100%", minHeight: 44, padding: "0.6rem 0.8rem",
        border: `1px solid ${c.overlap.matched > 0 ? colors.teal : colors.cardBorder}`,
        borderRadius: 10, background: colors.cardBg, boxShadow: "none",
        cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>DC #{c.challanNumber}</span>
        <span style={{ fontSize: "0.72rem", color: c.overlap.matched > 0 ? "#00695c" : colors.textSecondary }}>
          {c.overlap.total === 0
            ? "This bill has no lines to compare"
            : c.overlap.matched > 0
              ? `${c.overlap.matched} of ${c.overlap.total} bill item${c.overlap.total > 1 ? "s" : ""} match`
              : "No items in common with this bill"}
        </span>
      </span>
      <span style={{ fontSize: "0.75rem", color: colors.textSecondary, textAlign: "right" }}>
        {c.deliveryDate ? new Date(c.deliveryDate).toLocaleDateString() : ""}
        {c.poNumber ? ` · PO ${c.poNumber}` : ""}
        {c.items?.length ? ` · ${c.items.length} line${c.items.length > 1 ? "s" : ""}` : ""}
      </span>
    </button>
  );

  return (
    <div style={formStyles.backdrop} onClick={onClose}>
      <div
        style={{ ...formStyles.modal, maxWidth: modalSizes.lg }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={formStyles.header}>
          <h3 style={formStyles.title}>Delivery challan for Bill #{invoice.invoiceNumber}</h3>
          <button style={formStyles.closeButton} onClick={onClose} title="Close" aria-label="Close">
            &times;
          </button>
        </div>

        <div style={formStyles.body}>
          {error && <div style={{ ...formStyles.error, marginBottom: "0.9rem" }}>{error}</div>}

          <p style={{ marginTop: 0, fontSize: "0.85rem", color: colors.textSecondary }}>
            This bill was raised without a delivery challan. Attach one that already
            exists for <strong>{invoice.clientName}</strong>, or raise a new one from
            the bill&apos;s own lines.
          </p>

          {canCreateChallan && (
            <button
              disabled={busy}
              onClick={() => run(
                () => createChallanForInvoice(invoice.id),
                "Could not raise a delivery challan for this bill.")}
              style={{
                width: "100%", padding: "0.7rem 1rem", minHeight: 44, marginBottom: "1.1rem",
                border: `1px solid ${colors.teal}`, borderRadius: 10,
                background: "#e0f2f1", color: "#00695c", fontWeight: 600,
                fontSize: "0.85rem", boxShadow: "none",
                cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
              }}
            >
              Raise a new delivery challan from this bill
            </button>
          )}

          <div style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.5rem" }}>
            &hellip;or attach an existing one
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by challan number, PO or item…"
            style={{
              width: "100%", padding: "0.55rem 0.7rem", minHeight: 44,
              border: `1px solid ${colors.cardBorder}`, borderRadius: 8,
              fontSize: "0.85rem", boxSizing: "border-box",
            }}
          />

          {loading && (
            <div style={{ fontSize: "0.85rem", color: colors.textSecondary, paddingTop: "0.8rem" }}>
              Loading…
            </div>
          )}

          {!loading && attachable.length === 0 && blocked.length === 0 && (
            <div style={{ fontSize: "0.82rem", color: colors.textSecondary, padding: "0.9rem 0" }}>
              {q
                ? `Nothing matches "${search.trim()}" for ${invoice.clientName}.`
                : `No unbilled delivery challan for ${invoice.clientName}.`}
              {canCreateChallan ? " Raise one from this bill above." : ""}
            </div>
          )}

          {likely.length > 0 && groupLabel("Carries this bill's items")}
          <div style={{ display: "grid", gap: "0.5rem" }}>{likely.map(challanCard)}</div>

          {others.length > 0 && groupLabel(
            likely.length > 0 ? "Other unbilled challans for this buyer" : "Unbilled challans for this buyer")}
          <div style={{ display: "grid", gap: "0.5rem" }}>{others.map(challanCard)}</div>

          {/* Searching only: name what was found and why it cannot be used, so
              the operator stops looking for it. */}
          {blocked.length > 0 && (
            <>
              {groupLabel("Found, but cannot be attached")}
              <div style={{ display: "grid", gap: "0.5rem" }}>
                {blocked.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      gap: "0.75rem", flexWrap: "wrap",
                      padding: "0.6rem 0.8rem", borderRadius: 10,
                      border: `1px dashed ${colors.cardBorder}`, background: "#fafbfc",
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: "0.85rem", color: colors.textSecondary }}>
                      DC #{c.challanNumber}
                    </span>
                    <span style={{ fontSize: "0.73rem", color: "#b26a00", textAlign: "right" }}>
                      {c.reason}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
