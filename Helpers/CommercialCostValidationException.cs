namespace MyApp.Api.Helpers;

public sealed class CommercialCostValidationException(string userMessage) : InvalidOperationException(userMessage)
{
    public string UserMessage { get; } = userMessage;
}
