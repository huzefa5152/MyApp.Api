// One definition of "a submission to FBR is in flight", shared by every screen
// that renders or gates on FBR state.
//
// Both statuses mean the same thing to a user: FBR may already hold this
// invoice, so submitting again risks a second IRN for one sale — which is
// exactly what happened to invoice 3816 in production.
//
//   Submitting — the atomic claim is held; a POST is in progress.
//   Uncertain  — the POST went out and the outcome was never confirmed
//                (timeout or crash after send). Not claimable; an
//                administrator must verify at FBR and reset it.
//
// It lives here rather than beside each screen because the card and the table
// showing different states for one bill is itself the bug: a bill reading
// "Pending FBR submission" on its card while the table calls it "Submitting…"
// invites the very re-submit the claim exists to prevent.
export function isFbrInFlight(inv) {
  return inv?.fbrStatus === "Submitting" || inv?.fbrStatus === "Uncertain";
}
