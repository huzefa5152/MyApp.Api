using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IPOParserService
    {
        string ExtractTextFromPdf(Stream pdfStream);
        ParsedPODto ParsePO(string text);
        ParsedPODto ParsePdf(Stream pdfStream);
    }
}
