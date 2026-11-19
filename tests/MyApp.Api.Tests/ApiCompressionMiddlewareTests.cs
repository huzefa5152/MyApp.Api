using System.IO.Compression;
using System.Text;
using Microsoft.AspNetCore.Http;
using MyApp.Api.Middleware;
using Xunit;

namespace MyApp.Api.Tests;

// API reads are compressed without changing a byte of what the action wrote, and
// only JSON is ever held: a download or a stream goes straight out.
public class ApiCompressionMiddlewareTests
{
    private static async Task<(DefaultHttpContext Ctx, byte[] Sent)> Run(
        string? acceptEncoding, string contentType, byte[] body, int status = 200)
    {
        var ctx = new DefaultHttpContext();
        var sent = new MemoryStream();
        ctx.Response.Body = sent;
        if (acceptEncoding != null) ctx.Request.Headers.AcceptEncoding = acceptEncoding;
        var middleware = new ApiCompressionMiddleware(async c =>
        {
            c.Response.StatusCode = status;
            c.Response.ContentType = contentType;
            // Two writes, as a serializer does.
            await c.Response.Body.WriteAsync(body.AsMemory(0, body.Length / 2));
            await c.Response.Body.WriteAsync(body.AsMemory(body.Length / 2));
        });
        await middleware.InvokeAsync(ctx);
        return (ctx, sent.ToArray());
    }

    private static byte[] Json(int bytes) =>
        Encoding.UTF8.GetBytes("[" + string.Join(",", Enumerable.Range(0, bytes / 20).Select(i => $"{{\"id\":{i},\"n\":\"row\"}}")) + "]");

    private static byte[] Unpack(byte[] data, string encoding)
    {
        using var input = new MemoryStream(data);
        using Stream z = encoding == "br" ? new BrotliStream(input, CompressionMode.Decompress) : new GZipStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        z.CopyTo(output);
        return output.ToArray();
    }

    [Theory]
    [InlineData("gzip, deflate, br, zstd", "br")]
    [InlineData("br", "br")]
    [InlineData("gzip, deflate", "gzip")]
    [InlineData("br;q=0, gzip", "gzip")]
    [InlineData("identity", null)]
    [InlineData("deflate", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void PicksBrotliThenGzipThenNothing(string? header, string? expected) =>
        Assert.Equal(expected, ApiCompressionMiddleware.Negotiate(header));

    [Theory]
    [InlineData("gzip, deflate, br", "br")]
    [InlineData("gzip", "gzip")]
    public async Task ALargeJsonBodyIsCompressedAndDecodesToTheSameBytes(string accept, string encoding)
    {
        var body = Json(40_000);
        var (ctx, sent) = await Run(accept, "application/json; charset=utf-8", body);
        Assert.Equal(encoding, ctx.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(sent.Length, ctx.Response.ContentLength);
        Assert.True(sent.Length < body.Length / 3);
        Assert.Equal(body, Unpack(sent, encoding));
        Assert.Contains("Accept-Encoding", ctx.Response.Headers.Vary.ToString());
    }

    [Fact]
    public async Task ASmallJsonBodyIsSentAsItIs()
    {
        var body = Json(300);
        var (ctx, sent) = await Run("br", "application/json", body);
        Assert.False(ctx.Response.Headers.ContainsKey("Content-Encoding"));
        Assert.Equal(body, sent);
        Assert.Equal(body.Length, ctx.Response.ContentLength);
    }

    [Theory]
    [InlineData("application/pdf")]
    [InlineData("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [InlineData("text/event-stream")]
    [InlineData("image/png")]
    public async Task AnythingThatIsNotJsonGoesStraightThrough(string contentType)
    {
        var body = Json(40_000);
        var (ctx, sent) = await Run("br", contentType, body);
        Assert.False(ctx.Response.Headers.ContainsKey("Content-Encoding"));
        Assert.Equal(body, sent);
    }

    [Fact]
    public async Task ACallerThatTakesNoEncodingIsLeftAlone()
    {
        var body = Json(40_000);
        var (ctx, sent) = await Run(null, "application/json", body);
        Assert.False(ctx.Response.Headers.ContainsKey("Content-Encoding"));
        Assert.Equal(body, sent);
    }

    [Fact]
    public async Task AnErrorBodyKeepsItsStatus()
    {
        var body = Json(5_000);
        var (ctx, sent) = await Run("br", "application/json", body, status: 403);
        Assert.Equal(403, ctx.Response.StatusCode);
        Assert.Equal(body, Unpack(sent, "br"));
    }

    [Fact]
    public async Task AnEmptyResponseStaysEmpty()
    {
        var ctx = new DefaultHttpContext();
        var sent = new MemoryStream();
        ctx.Response.Body = sent;
        ctx.Request.Headers.AcceptEncoding = "br";
        await new ApiCompressionMiddleware(c => { c.Response.StatusCode = 204; return Task.CompletedTask; }).InvokeAsync(ctx);
        Assert.Equal(204, ctx.Response.StatusCode);
        Assert.Empty(sent.ToArray());
        Assert.Null(ctx.Response.ContentLength);
    }
}
