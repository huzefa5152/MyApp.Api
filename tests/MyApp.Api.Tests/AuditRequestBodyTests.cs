using System.Text;
using MyApp.Api.Helpers;
using Xunit;

public class AuditRequestBodyTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(3999)]
    [InlineData(4000)]
    [InlineData(4001)]
    [InlineData(1000000)]
    public async Task KeepsTheSamePrefixAndRestoresStream(int length)
    {
        var text = new string('é', length);
        using var body = new MemoryStream(Encoding.UTF8.GetBytes(text));
        body.Position = Math.Min(3, body.Length);
        var before = body.Position;
        var result = await AuditRequestBody.ReadPrefixAsync(body);
        Assert.Equal(length > 4000 ? text[..4000] + "...(truncated)" : text, result);
        Assert.Equal(before, body.Position);
        Assert.True(body.CanRead);
    }

    [Fact]
    public async Task LargeBodyReadsAreBounded()
    {
        using var body = new CountingStream(new byte[25 * 1024 * 1024]);
        await AuditRequestBody.ReadPrefixAsync(body);
        Assert.InRange(body.BytesRead, 4001, 16384);
    }

    private sealed class CountingStream(byte[] bytes) : MemoryStream(bytes)
    {
        public int BytesRead { get; private set; }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            var read = base.Read(buffer.Span);
            BytesRead += read;
            return ValueTask.FromResult(read);
        }
    }
}
