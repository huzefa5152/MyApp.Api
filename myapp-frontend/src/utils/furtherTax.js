// Default for the standard-rate unregistered-buyer scenario. Saved client
// information is sufficient; an unavailable registry lookup never blocks filing.
export function defaultFurtherTaxRate(scenarioCode, registrationType) {
  if (String(registrationType || "").trim().toLowerCase() === "registered") return null;
  return scenarioCode === "SN002" ? 4 : null;
}
