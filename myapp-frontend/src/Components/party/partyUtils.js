// Shared helpers for the Clients and Suppliers directory screens.

export const REGISTRATION_TYPES = ["Registered", "FTN", "Unregistered", "CNIC"];

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #0d47a1, #1976d2)",
  "linear-gradient(135deg, #00695c, #00897b)",
  "linear-gradient(135deg, #0a3680, #00897b)",
  "linear-gradient(135deg, #1565c0, #26a69a)",
  "linear-gradient(135deg, #283593, #3949ab)",
  "linear-gradient(135deg, #00796b, #4db6ac)",
];

export function initials(name) {
  const words = (name || "").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

export function avatarGradient(name) {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

export function badgeTone(type) {
  return REGISTRATION_TYPES.includes(type) ? type.toLowerCase() : "none";
}

// The same identity FBR checks on every invoice: registration type and
// province. NTN for a Registered party. Flagged on the card so the operator
// fixes it before a bill is refused, not after.
export function missingFbrDetails(p) {
  const missing = [];
  if (!p.registrationType) missing.push("registration type");
  if (p.fbrProvinceCode == null) missing.push("province");
  if (p.registrationType === "Registered" && !p.ntn) missing.push("NTN");
  return missing;
}

export function matchesSearch(p, q) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return [p.name, p.email, p.phone, p.ntn, p.strn, p.cnic, p.address, p.contactPerson, p.site]
    .some((v) => (v || "").toString().toLowerCase().includes(needle));
}

export function countByType(rows) {
  const counts = { all: rows.length };
  for (const r of rows) {
    const key = REGISTRATION_TYPES.includes(r.registrationType) ? r.registrationType : "None";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
