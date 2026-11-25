namespace MyApp.Api.Helpers
{
    /// <summary>
    /// FBR's reason rule for a Debit / Credit Note, shared by note creation and
    /// the FBR pre-validate so a note refused at filing is refused when it is
    /// made. The sandbox enforces both halves (2026-11-25): no reason is
    /// [0027], reason "Others" without remarks is [0028].
    /// </summary>
    public static class NoteReasonRule
    {
        public static string? Problem(string label, string? reason, string? remarks)
        {
            if (string.IsNullOrWhiteSpace(reason))
                return $"A reason is required for a {label}. [FBR 0027]";
            if (string.Equals(reason.Trim(), "Others", StringComparison.OrdinalIgnoreCase)
                && string.IsNullOrWhiteSpace(remarks))
                return "Remarks are required when the reason is \"Others\". [FBR 0028]";
            return null;
        }
    }
}
