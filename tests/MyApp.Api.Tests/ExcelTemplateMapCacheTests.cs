using System.Reflection;
using ClosedXML.Excel;
using Microsoft.Extensions.Caching.Memory;
using MyApp.Api.Services.Implementations;
using Xunit;

public class ExcelTemplateMapCacheTests
{
    [Fact]
    public void BoundedCacheKeepsTimestampInvalidationAndRebuildsEquivalentMaps()
    {
        var root = Path.Combine(Path.GetTempPath(), "MyApp-Map-Audit-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var source = Path.Combine(root, "source.xlsx");
            using (var book = new XLWorkbook())
            { book.AddWorksheet("Sample").Cell("A1").Value = "{{challanNumber}}"; book.SaveAs(source); }
            using var mapper = new ExcelTemplateReverseMapper();
            var initial = mapper.Build(source);
            Assert.Same(initial, mapper.Build(source));
            for (var i = 0; i < 130; i++)
            {
                var path = Path.Combine(root, i + ".xlsx");
                File.Copy(source, path);
                Assert.Equal(initial.HeaderFields, mapper.Build(path).HeaderFields);
            }
            var cache = (MemoryCache)typeof(ExcelTemplateReverseMapper).GetField("_cache", BindingFlags.NonPublic | BindingFlags.Instance)!.GetValue(mapper)!;
            Assert.InRange(cache.Count, 1, 128);
            using (var book = new XLWorkbook(source))
            { book.Worksheet(1).Cell("B1").Value = "{{clientName}}"; book.SaveAs(source); }
            File.SetLastWriteTimeUtc(source, DateTime.UtcNow.AddSeconds(2));
            var updated = mapper.Build(source);
            Assert.True(updated.HeaderFields.ContainsKey("clientName"));
            Assert.Throws<FileNotFoundException>(() => mapper.Build(Path.Combine(root, "missing.xlsx")));
        }
        finally { Directory.Delete(root, true); }
    }
}
