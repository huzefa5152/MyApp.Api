// API compression and the keep-warm origin rule (performance audit 2026-11-20).
//   cd scripts/perf_harness && dotnet run -c Release
using System.IO.Compression;
using System.Text;
using Microsoft.AspNetCore.Http;
using MyApp.Api.Middleware;
using MyApp.Api.Services.HostedServices;

int failed = 0, run = 0;
void Check(string name, bool ok)
{
    run++;
    if (ok) { Console.WriteLine($"  ok    {name}"); return; }
    failed++;
    Console.WriteLine($"  FAIL  {name}");
}

static async Task<(DefaultHttpContext Ctx, byte[] Sent)> Send(string? accept, string type, byte[] body, int status = 200)
{
    var ctx = new DefaultHttpContext();
    var sent = new MemoryStream();
    ctx.Response.Body = sent;
    if (accept != null) ctx.Request.Headers.AcceptEncoding = accept;
    await new ApiCompressionMiddleware(async c =>
    {
        c.Response.StatusCode = status;
        c.Response.ContentType = type;
        await c.Response.Body.WriteAsync(body.AsMemory(0, body.Length / 2));   // two writes, as a serializer does
        await c.Response.Body.WriteAsync(body.AsMemory(body.Length / 2));
    }).InvokeAsync(ctx);
    return (ctx, sent.ToArray());
}

static byte[] Json(int bytes) =>
    Encoding.UTF8.GetBytes("[" + string.Join(",", Enumerable.Range(0, bytes / 20).Select(i => $"{{\"id\":{i},\"n\":\"row\"}}")) + "]");

static byte[] Unpack(byte[] data, string enc)
{
    using var input = new MemoryStream(data);
    using Stream z = enc == "br" ? new BrotliStream(input, CompressionMode.Decompress) : new GZipStream(input, CompressionMode.Decompress);
    using var output = new MemoryStream();
    z.CopyTo(output);
    return output.ToArray();
}

Console.WriteLine("-- which encoding --");
foreach (var (h, want) in new (string?, string?)[] {
    ("gzip, deflate, br, zstd", "br"), ("br", "br"), ("gzip, deflate", "gzip"), ("br;q=0, gzip", "gzip"),
    ("identity", null), ("deflate", null), ("", null), (null, null) })
    Check($"'{h}' -> {want ?? "none"}", ApiCompressionMiddleware.Negotiate(h) == want);

Console.WriteLine("-- a large JSON body is compressed and decodes to the same bytes --");
foreach (var (accept, enc) in new[] { ("gzip, deflate, br", "br"), ("gzip", "gzip") })
{
    var body = Json(40_000);
    var (ctx, sent) = await Send(accept, "application/json; charset=utf-8", body);
    Check($"{enc}: header", ctx.Response.Headers.ContentEncoding.ToString() == enc);
    Check($"{enc}: Content-Length is what was sent", ctx.Response.ContentLength == sent.Length);
    Check($"{enc}: smaller", sent.Length < body.Length / 3);
    Check($"{enc}: identical once decoded", Unpack(sent, enc).SequenceEqual(body));
    Check($"{enc}: Vary: Accept-Encoding", ctx.Response.Headers.Vary.ToString().Contains("Accept-Encoding"));
}

Console.WriteLine("-- left alone --");
{
    var small = Json(300);
    var (ctx, sent) = await Send("br", "application/json", small);
    Check("a body under 1 KB goes as it is", !ctx.Response.Headers.ContainsKey("Content-Encoding") && sent.SequenceEqual(small));
}
foreach (var type in new[] { "application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/event-stream", "image/png" })
{
    var body = Json(40_000);
    var (ctx, sent) = await Send("br", type, body);
    Check($"{type} passes straight through", !ctx.Response.Headers.ContainsKey("Content-Encoding") && sent.SequenceEqual(body));
}
{
    var body = Json(40_000);
    var (ctx, sent) = await Send(null, "application/json", body);
    Check("a caller that takes no encoding gets it plain", !ctx.Response.Headers.ContainsKey("Content-Encoding") && sent.SequenceEqual(body));
}
{
    var body = Json(5_000);
    var (ctx, sent) = await Send("br", "application/json", body, 403);
    Check("an error keeps its status and body", ctx.Response.StatusCode == 403 && Unpack(sent, "br").SequenceEqual(body));
}
{
    var ctx = new DefaultHttpContext();
    var sent = new MemoryStream();
    ctx.Response.Body = sent;
    ctx.Request.Headers.AcceptEncoding = "br";
    await new ApiCompressionMiddleware(c => { c.Response.StatusCode = 204; return Task.CompletedTask; }).InvokeAsync(ctx);
    Check("an empty response stays empty", ctx.Response.StatusCode == 204 && sent.Length == 0 && ctx.Response.ContentLength == null);
}

Console.WriteLine("-- the keep-warm ping only goes to the site's own host --");
foreach (var (host, configured, ok) in new (string?, string?, bool)[] {
    ("example-site.runasp.net", null, true), ("EXAMPLE-SITE.RUNASP.NET", null, true), ("localhost", null, false),
    ("attacker.example", null, false), ("runasp.net.attacker.example", null, false), ("", null, false), (null, null, false),
    ("erp.example.test", "erp.example.test", true), ("other.example.test", "erp.example.test", false) })
    Check($"'{host}' with '{configured}' -> {(ok ? "accepted" : "refused")}", KeepWarmOrigin.Accepts(host, configured) == ok);

Console.WriteLine(failed == 0 ? $"{run}/{run} performance harness checks passed" : $"{failed} of {run} FAILED");
return failed == 0 ? 0 : 1;
