using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    // Deterministic rule-based parser. Consumes a POFormat (with its frozen
    // RuleSetJson) + raw text and returns a ParsedPODto with no LLM calls.
    public interface IRuleBasedPOParser
    {
        ParsedPODto Parse(string rawText, POFormat format);
    }
}
