import { useEffect, useMemo, useRef, useState } from "react";
import { getImportedTaxRates, getItemsImportedAt } from "../api/invoiceApi";

/**
 * What this company's own GD lines / opening stock say about the sales tax
 * rate of the items on a bill, against the rate the bill is about to charge.
 *
 * The rule and its wording live on the server (Helpers/ImportedTaxRate) and are
 * the same ones the save guard enforces, so the form shows exactly what saving
 * would refuse. This hook only fetches and sorts:
 *
 *   checks    — { [itemTypeId]: the server's row }, for per-line hints
 *   enforced  — findings from unambiguous evidence: saving needs a reason
 *   advisory  — contradictory evidence: shown for review, never blocks
 *   billRates — the distinct rates the bill's items came in at, so a form can
 *               tell a one-click scenario switch from a bill that must be split
 *   importedAtRate — when `widenForRate` is given, the ids of items this company
 *               imported unambiguously at that rate. A form widens its item
 *               picker with it under a non-standard scenario, whose sale-type
 *               filter otherwise hides every item with no sale type of its own
 *               (all of the 25% goods) — leaving SN024 nothing to bill.
 *
 * A failed request yields no findings rather than an error: the check is a
 * courtesy, the server refusal is the control, and a flaky network must not
 * stop anyone raising a bill.
 */
export default function useImportedTaxRates(companyId, itemTypeIds, billRate, { widenForRate } = {}) {
  const key = useMemo(
    () => [...new Set((itemTypeIds || []).map(Number).filter((n) => n > 0))]
      .sort((a, b) => a - b)
      .join(","),
    [itemTypeIds],
  );
  const [checks, setChecks] = useState({});
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    if (!companyId || !key) {
      setChecks({});
      return undefined;
    }
    // Picking items fires in bursts; one request for the burst.
    const timer = setTimeout(async () => {
      try {
        const res = await getImportedTaxRates(companyId, key, billRate);
        if (mine !== seq.current) return;           // a newer pick superseded it
        const next = {};
        for (const row of res.data || []) next[row.itemTypeId] = row;
        setChecks(next);
      } catch {
        if (mine === seq.current) setChecks({});
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [companyId, key, billRate]);

  const [importedAtRate, setImportedAtRate] = useState(() => new Set());
  useEffect(() => {
    let alive = true;
    if (!companyId || !(Number(widenForRate) > 0)) {
      setImportedAtRate(new Set());
      return undefined;
    }
    getItemsImportedAt(companyId, widenForRate)
      .then((res) => { if (alive) setImportedAtRate(new Set((res.data || []).map(Number))); })
      .catch(() => { if (alive) setImportedAtRate(new Set()); });
    return () => { alive = false; };
  }, [companyId, widenForRate]);

  return useMemo(() => {
    const rows = Object.values(checks);
    const warnings = rows.map((r) => r.warning).filter(Boolean);
    // Mixed records say nothing reliable about which rate this sale is, so they
    // do not count towards "this bill holds goods of two rates".
    const billRates = [...new Set(
      rows.filter((r) => r.rate != null && !r.mixed).map((r) => Number(r.rate)),
    )].sort((a, b) => a - b);
    return {
      checks,
      enforced: warnings.filter((w) => w.enforce),
      advisory: warnings.filter((w) => !w.enforce),
      billRates,
      importedAtRate,
    };
  }, [checks, importedAtRate]);
}
