// Customer documents a purchase serves (sales order → challan → sale bill).
const LABEL = { order: "SO", challan: "DC", bill: "Bill" };
const NAME = { order: "Sales Order", challan: "Challan", bill: "Bill" };

/** "SO #12" */
export const docTag = (t) => `${LABEL[t.kind] || t.kind} #${t.number}`;

/** "Sales Order #12 · Sample Textiles" — for titles and tooltips. */
export const docTitle = (t) =>
  `${NAME[t.kind] || t.kind} #${t.number}${t.clientName ? ` · ${t.clientName}` : ""}`;

/** "SO #12 · DC #101 · Bill #55" */
export const docTrail = (tags = []) => tags.map(docTag).join(" · ");
