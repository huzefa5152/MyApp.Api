using System.Net.Mail;
using System.Text.Json;
using MyApp.Api.DTOs;
namespace MyApp.Api.Helpers;
public static class EmailWorkspaceRules
{
    public static List<EmailSenderRule> Read(string json) => JsonSerializer.Deserialize<List<EmailSenderRule>>(json) ?? new();
    public static string NormalizeAddress(string address)
    {
        try { return new MailAddress(address.Trim()).Address.ToLowerInvariant(); }
        catch { throw new ArgumentException("Enter a valid sender email address."); }
    }
    public static bool Matches(EmailSenderRule rule, string sender, string subject) =>
        string.Equals(rule.Sender, sender, StringComparison.OrdinalIgnoreCase) &&
        (string.IsNullOrWhiteSpace(rule.SubjectContains) || subject.Contains(rule.SubjectContains, StringComparison.OrdinalIgnoreCase));
    public static List<string> ValidateDraft(EmailDraftDto draft, bool requireBrand, bool requireSpecifications)
    {
        var errors = new List<string>();
        if (draft.ClientId is not > 0) errors.Add("Select a customer.");
        if (draft.Date == default) errors.Add("Choose a quotation date.");
        if (draft.ValidUntil < draft.Date) errors.Add("Validity cannot end before the quotation date.");
        if (draft.GSTRate is < 0 or > 100) errors.Add("GST rate must be between 0 and 100.");
        if (draft.Items.Count is < 1 or > 200) errors.Add("An enquiry needs between 1 and 200 items.");
        foreach (var (item, index) in draft.Items.Select((item, index) => (item, index)))
        {
            if (string.IsNullOrWhiteSpace(item.Description) || string.IsNullOrWhiteSpace(item.Unit) || item.Quantity <= 0 || item.UnitPrice is null or < 0)
                errors.Add($"Item {index + 1}: complete description, unit, positive quantity and a non-negative unit price.");
            if (requireBrand && string.IsNullOrWhiteSpace(item.Brand)) errors.Add($"Item {index + 1}: brand / make is required.");
        }
        if (!draft.Reviewed) errors.Add("Confirm that you reviewed the enquiry.");
        if (requireSpecifications && !draft.SpecificationsConfirmed) errors.Add("Confirm the referenced sample / drawing specifications.");
        return errors;
    }
}
