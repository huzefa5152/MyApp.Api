using System.Reflection;
using System.Text;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The Pakistan Customs Tariff that ships inside the assembly.
    ///
    /// FBR's PRAL catalog endpoints all answer 401 without an OAuth token, but
    /// FBR publishes the tariff itself as an open PDF. That PDF is parsed ONCE,
    /// offline, by <c>scripts/build_hscode_dataset.py</c>, and the result is
    /// embedded here so the HS master can be loaded with no token, no network
    /// and no per-deploy file copying.
    ///
    /// Embedded rather than a file under <c>Data/</c> on purpose: a deploy that
    /// ships only the binaries would leave a loose file behind, and the failure
    /// would not show up until an operator pressed the button.
    /// </summary>
    public static class BundledTariff
    {
        private const string ResourceSuffix = "pakistan-customs-tariff.csv";

        /// <summary>
        /// Codes and descriptions, plus the human-readable edition taken from the
        /// file's own banner row ("Pakistan Customs Tariff 2025-26").
        ///
        /// Throws <see cref="InvalidOperationException"/> when the resource is
        /// missing — that is a build problem, not an operator problem, and it
        /// should be loud.
        /// </summary>
        public static (List<(string Code, string? Description)> Codes, string Edition) Read()
        {
            var assembly = Assembly.GetExecutingAssembly();
            var name = assembly.GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith(ResourceSuffix, StringComparison.OrdinalIgnoreCase));

            if (name == null)
                throw new InvalidOperationException(
                    $"The bundled customs tariff ({ResourceSuffix}) is not embedded in this build.");

            using var stream = assembly.GetManifestResourceStream(name)
                ?? throw new InvalidOperationException($"Could not open the embedded {ResourceSuffix}.");
            using var reader = new StreamReader(stream, Encoding.UTF8);

            var codes = new List<(string, string?)>(8000);
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var edition = "Published Pakistan Customs Tariff";

            string? line;
            var lineNo = 0;
            while ((line = reader.ReadLine()) != null)
            {
                lineNo++;
                if (line.Length == 0) continue;

                // Row 1 is the banner: "# Pakistan Customs Tariff,2025-26,…"
                if (lineNo == 1 && line.StartsWith("#", StringComparison.Ordinal))
                {
                    var parts = SplitCsv(line);
                    if (parts.Count >= 2)
                        edition = $"{parts[0].TrimStart('#', ' ')} {parts[1]}".Trim();
                    continue;
                }
                // Row 2 is the header.
                if (line.StartsWith("Code,", StringComparison.OrdinalIgnoreCase)) continue;

                var fields = SplitCsv(line);
                if (fields.Count < 2) continue;

                var code = fields[0].Trim();
                if (code.Length == 0 || !seen.Add(code)) continue;

                var description = fields[1].Trim();
                codes.Add((code, description.Length == 0 ? null : description));
            }

            return (codes, edition);
        }

        /// <summary>
        /// Minimal CSV field split — quoted fields with embedded commas and
        /// doubled quotes. The generator writes descriptions verbatim from the
        /// tariff, and plenty of them contain commas.
        /// </summary>
        private static List<string> SplitCsv(string line)
        {
            var fields = new List<string>(2);
            var value = new StringBuilder();
            var quoted = false;

            for (int i = 0; i < line.Length; i++)
            {
                var c = line[i];
                if (quoted)
                {
                    if (c == '"')
                    {
                        if (i + 1 < line.Length && line[i + 1] == '"') { value.Append('"'); i++; }
                        else quoted = false;
                    }
                    else value.Append(c);
                }
                else if (c == '"') quoted = true;
                else if (c == ',') { fields.Add(value.ToString()); value.Clear(); }
                else value.Append(c);
            }
            fields.Add(value.ToString());
            return fields;
        }
    }
}
