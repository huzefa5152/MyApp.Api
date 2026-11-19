// A buyer the record SAYS is unregistered. Stricter than the default below on
// purpose: this one drives a statement on screen, so an unset type says nothing.
export function isUnregisteredBuyer(registrationType) {
  return ["unregistered", "cnic"].includes(
    String(registrationType || "")
      .trim()
      .toLowerCase(),
  );
}

// Default for the standard-rate unregistered-buyer scenario. Saved client
// information is sufficient; an unavailable registry lookup never blocks filing.
export function defaultFurtherTaxRate(scenarioCode, registrationType) {
  if (
    String(registrationType || "")
      .trim()
      .toLowerCase() === "registered"
  )
    return null;
  return scenarioCode === "SN002" ? 4 : null;
}
