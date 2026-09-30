// The fingerprint service implements this interface; the real one lives in a
// file that pulls in the whole DTO/Model graph, so the harness declares it.
namespace MyApp.Api.Services.Interfaces
{
    public interface IPOFormatFingerprintService { FingerprintResult Compute(string rawText); }
    public record FingerprintResult(string Hash, string Signature, IReadOnlyList<string> Keywords);
}
