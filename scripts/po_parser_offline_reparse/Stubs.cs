// Minimal stand-ins so the source-linked parser compiles without dragging in
// EF / the whole model graph (mirror of scripts/po_parser_harness/Stubs.cs).
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
