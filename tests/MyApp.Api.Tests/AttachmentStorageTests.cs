using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using MyApp.Api.Helpers;
using Xunit;

public class AttachmentStorageTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "MyApp-Audit-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task StoredBytesHashAndMetadataRemainIdentical()
    {
        var bytes = new byte[1024 * 1024];
        RandomNumberGenerator.Fill(bytes);
        using var input = new MemoryStream(bytes);
        var storage = new AttachmentStorage(new Environment(root));
        var result = await storage.SaveAsync("Sample folder", new FormFile(input, 0, bytes.Length, "file", "Sample.PDF"));
        Assert.Equal(".pdf", result.Extension);
        Assert.StartsWith("Sample folder/", result.StoragePath);
        Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), result.Sha256);
        Assert.Equal(bytes, await File.ReadAllBytesAsync(storage.ResolveExisting(result.StoragePath)!));
    }

    [Fact]
    public async Task FailedCopyDoesNotLeaveAnOrphan()
    {
        var storage = new AttachmentStorage(new Environment(root));
        await Assert.ThrowsAsync<IOException>(() => storage.SaveAsync(null, new FailedFile()));
        Assert.Empty(Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories));
    }

    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }

    private sealed class FailedFile : IFormFile
    {
        public string ContentType => "application/pdf";
        public string ContentDisposition => "";
        public IHeaderDictionary Headers => new HeaderDictionary();
        public long Length => 100;
        public string Name => "file";
        public string FileName => "sample.pdf";
        public void CopyTo(Stream target) => throw new NotSupportedException();
        public Stream OpenReadStream() => throw new NotSupportedException();
        public async Task CopyToAsync(Stream target, CancellationToken ct = default)
        { await target.WriteAsync(new byte[50], ct); throw new IOException("Interrupted copy"); }
    }

    private sealed class Environment(string path) : IWebHostEnvironment
    {
        public string WebRootPath { get; set; } = path;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "AuditTests";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = path;
        public string EnvironmentName { get; set; } = "Development";
    }
}
