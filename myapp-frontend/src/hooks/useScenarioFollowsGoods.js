import { useEffect, useState } from "react";

/**
 * Until the operator picks a scenario themselves, a new bill's scenario follows
 * the goods on it.
 *
 * The create forms open on SN001 (18%) because most bills are standard rate,
 * and that opening is a guess. When the goods' own records settle it the other
 * way -- they came in at 25%, which only SN024 carries -- the guess is replaced
 * by the scenario they need, and the GST rate and SRO reference follow it.
 * Opening on 18% and waiting for someone to notice a red card is how 25% goods
 * came to be billed at 18%.
 *
 * It acts ONLY on the one-click suggestion the rate notice already offers
 * (`suggestion`): that exists only when the server enforces the finding -- one
 * clear record, 18% against 25% -- and exactly one scenario carries the rate.
 * Mixed records, a GD line under another HS code, or goods at two rates never
 * move the scenario; they stay notices.
 *
 *   source "default"  -- the opening SN001, untouched
 *          "goods"    -- set from the goods by this hook
 *          "operator" -- picked by the operator: never changed from here on, and
 *                        a disagreement is the ordinary notice (switch, or give
 *                        a reason)
 *
 * A scenario set from the goods goes back to the default once nothing on the
 * bill calls for it any more (the 25% line removed, say), so an operator who
 * changes their mind about the goods is not left on SN024.
 */
export default function useScenarioFollowsGoods({
  suggestion,          // the rate notice's { code, ... } or null
  billRates,           // distinct rates the items' records give (mixed excluded)
  scenarios,
  scenarioCode,
  setScenarioCode,
  defaultCode = "SN001",
}) {
  const [source, setSource] = useState("default");
  const suggestedCode = suggestion?.code || "";
  const ratesKey = (billRates || []).join(",");

  useEffect(() => {
    if (source === "operator" || !scenarios?.length) return;

    if (suggestedCode) {
      if (scenarioCode !== suggestedCode) {
        setScenarioCode(suggestedCode);
        setSource("goods");
      }
      return;
    }

    if (source !== "goods") return;
    const current = scenarios.find((s) => s.code === scenarioCode);
    const rates = ratesKey ? ratesKey.split(",").map(Number) : [];
    const stillCalledFor = current && rates.some((r) => r === Number(current.defaultRate));
    if (!stillCalledFor && scenarios.some((s) => s.code === defaultCode)) {
      setScenarioCode(defaultCode);
      setSource("default");
    }
  }, [suggestedCode, ratesKey, source, scenarios, scenarioCode, setScenarioCode, defaultCode]);

  return {
    source,
    // Call from every control where the OPERATOR chooses a scenario.
    markOperatorChoice: () => setSource("operator"),
  };
}
