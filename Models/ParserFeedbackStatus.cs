namespace MyApp.Api.Models
{
    /// <summary>
    /// Operator's verdict on how well the PO parser extracted a document.
    /// An enum (not a bool) so future verdicts — e.g. PartiallyCorrect — can be
    /// appended without a schema change. Stored as its integer value; values
    /// are pinned so ordinals never shift under a reorder.
    /// </summary>
    public enum ParserFeedbackStatus
    {
        Correct = 0,
        Incorrect = 1,
    }
}
