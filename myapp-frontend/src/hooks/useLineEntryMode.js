import { useUiPreference } from "./useUiPreference";
import { ENTRY_MODE } from "../utils/lineAmount";

/**
 * The operator's choice of what they type on each line — unit price or line
 * total — remembered per screen ("quote", "sales-order", "bill", "bill-challan"),
 * so a shop that always prices by the total keeps it.
 */
export default function useLineEntryMode(screenKey) {
  const [raw, setRaw] = useUiPreference(`line-entry-mode:${screenKey}`, ENTRY_MODE.price);
  const mode = raw === ENTRY_MODE.total ? ENTRY_MODE.total : ENTRY_MODE.price;
  return [mode, (next) => setRaw(next === ENTRY_MODE.total ? ENTRY_MODE.total : ENTRY_MODE.price)];
}
