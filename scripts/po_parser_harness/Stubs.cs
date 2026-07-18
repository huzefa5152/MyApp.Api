// Minimal stand-ins for the two types the parser references but that would
// otherwise drag in EF / the whole model graph. Only the members the parser
// actually touches are provided — the parsing logic under test is identical.
namespace MyApp.Api.Models
{
    public class POFormat
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public int CurrentVersion { get; set; } = 1;
        public string RuleSetJson { get; set; } = "{}";
    }
}

namespace MyApp.Api.Services.Interfaces
{
    using MyApp.Api.DTOs;
    using MyApp.Api.Models;

    public interface IRuleBasedPOParser
    {
        ParsedPODto Parse(string rawText, POFormat format);
    }
}
