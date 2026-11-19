using System.IO.Compression;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Net.Http.Headers;

namespace MyApp.Api.Middleware
{
    /// <summary>
    /// Compresses the JSON the API reads back (performance audit 2026-11-20).
    ///
    /// The framework's own response-compression middleware was tried first and
    /// measured on production: it writes a compressed response in more than one
    /// small send, and a screen that makes a single call then waited 150-190 ms
    /// longer than it did uncompressed (a 0.14 s call became 0.32 s). So this
    /// one holds the JSON in memory and sends it in ONE write with a
    /// Content-Length, exactly as an uncompressed response goes out:
    ///
    ///   * a JSON body of <see cref="MinimumBytes"/> or more is compressed
    ///     (Brotli when the browser takes it, otherwise gzip);
    ///   * a smaller JSON body is sent as it is -- it fits in one packet and
    ///     compressing it buys nothing;
    ///   * anything that is NOT JSON -- a PDF, an Excel export, an attachment,
    ///     an event stream -- is passed straight through, never held.
    ///
    /// It is mounted for GET requests under /api only, and never for the
    /// sign-in or agent-token routes (see Program.cs): a response that carries
    /// a secret is not compressed, which keeps BREACH off the table.
    ///
    /// The body it sends is byte-identical, once decoded, to what the action
    /// wrote. It reads no data and takes no decision about what is returned.
    /// </summary>
    public class ApiCompressionMiddleware
    {
        /// <summary>Below this a response is one packet either way.</summary>
        public const int MinimumBytes = 1024;

        private readonly RequestDelegate _next;

        public ApiCompressionMiddleware(RequestDelegate next) => _next = next;

        /// <summary>"br", "gzip" or null: what this caller accepts, Brotli first.</summary>
        public static string? Negotiate(string? acceptEncoding)
        {
            if (string.IsNullOrWhiteSpace(acceptEncoding)) return null;
            if (!StringWithQualityHeaderValue.TryParseList(new[] { acceptEncoding }, out var offered) || offered == null)
                return null;
            bool Takes(string name) => offered.Any(o =>
                o.Value.Equals(name, StringComparison.OrdinalIgnoreCase) && o.Quality.GetValueOrDefault(1) > 0);
            return Takes("br") ? "br" : Takes("gzip") ? "gzip" : null;
        }

        public static bool IsJson(string? contentType) =>
            contentType != null
            && (contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase)
                || contentType.StartsWith("application/problem+json", StringComparison.OrdinalIgnoreCase));

        public async Task InvokeAsync(HttpContext context)
        {
            var encoding = Negotiate(context.Request.Headers.AcceptEncoding);
            var original = context.Features.Get<IHttpResponseBodyFeature>();
            if (encoding == null || original == null)
            {
                await _next(context);
                return;
            }

            var held = new HoldJsonStream(context.Response, original.Stream);
            var feature = new StreamResponseBodyFeature(held, original);
            context.Features.Set<IHttpResponseBodyFeature>(feature);
            try
            {
                await _next(context);
                await feature.CompleteAsync();   // push anything still in its writer into `held`
            }
            finally
            {
                context.Features.Set(original);
            }

            if (!held.Holding) return;           // not JSON: it already went straight out

            var response = context.Response;
            var body = held.Body;
            response.Headers.Append(HeaderNames.Vary, HeaderNames.AcceptEncoding);

            if (body.Length < MinimumBytes || response.Headers.ContainsKey(HeaderNames.ContentEncoding))
            {
                if (body.Length == 0) return;
                response.ContentLength = body.Length;
                await original.Stream.WriteAsync(body.GetBuffer().AsMemory(0, (int)body.Length));
                return;
            }

            using var packed = new MemoryStream((int)Math.Min(body.Length / 4 + 256, int.MaxValue));
            await using (Stream z = encoding == "br"
                ? new BrotliStream(packed, CompressionLevel.Optimal, leaveOpen: true)
                : new GZipStream(packed, CompressionLevel.Fastest, leaveOpen: true))
            {
                await z.WriteAsync(body.GetBuffer().AsMemory(0, (int)body.Length));
            }

            response.Headers.ContentEncoding = encoding;
            response.Headers.Remove(HeaderNames.ContentMD5);
            response.ContentLength = packed.Length;
            await original.Stream.WriteAsync(packed.GetBuffer().AsMemory(0, (int)packed.Length));
        }

        /// <summary>
        /// Decides on the first write, when the content type is known: JSON is
        /// held in memory, everything else goes straight to the real stream.
        /// </summary>
        private sealed class HoldJsonStream : Stream
        {
            private readonly HttpResponse _response;
            private readonly Stream _real;
            private bool? _holding;

            public HoldJsonStream(HttpResponse response, Stream real)
            {
                _response = response;
                _real = real;
            }

            public MemoryStream Body { get; } = new();

            /// <summary>True when the response is JSON (or nothing was written at all).</summary>
            public bool Holding => _holding ?? true;

            private bool Decide() => _holding ??= IsJson(_response.ContentType);

            public override bool CanRead => false;
            public override bool CanSeek => false;
            public override bool CanWrite => true;
            public override long Length => throw new NotSupportedException();
            public override long Position
            {
                get => throw new NotSupportedException();
                set => throw new NotSupportedException();
            }

            public override void Write(byte[] buffer, int offset, int count)
            {
                if (Decide()) Body.Write(buffer, offset, count);
                else _real.Write(buffer, offset, count);
            }

            public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
            {
                if (!Decide()) return _real.WriteAsync(buffer, cancellationToken);
                Body.Write(buffer.Span);
                return ValueTask.CompletedTask;
            }

            public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
                WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

            // A held response is sent whole at the end; a passed-through one
            // (a download, an event stream) flushes exactly as it always did.
            public override void Flush()
            {
                if (_holding == false) _real.Flush();
            }

            public override Task FlushAsync(CancellationToken cancellationToken) =>
                _holding == false ? _real.FlushAsync(cancellationToken) : Task.CompletedTask;

            public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
            public override void SetLength(long value) => throw new NotSupportedException();
        }
    }
}
