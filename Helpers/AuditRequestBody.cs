namespace MyApp.Api.Helpers;

public static class AuditRequestBody
{
    public static async Task<string?> ReadPrefixAsync(Stream body)
    {
        if (!body.CanSeek) return null;
        var position = body.Position;
        try
        {
            body.Position = 0;
            using var reader = new StreamReader(body, leaveOpen: true);
            var buffer = new char[4001];
            var length = 0;
            while (length < buffer.Length)
            {
                var read = await reader.ReadAsync(buffer.AsMemory(length));
                if (read == 0) break;
                length += read;
            }
            return length > 4000
                ? new string(buffer, 0, 4000) + "...(truncated)"
                : new string(buffer, 0, length);
        }
        finally { body.Position = position; }
    }
}
