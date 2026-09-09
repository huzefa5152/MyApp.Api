using Microsoft.Data.SqlClient;

namespace MyApp.Api.Helpers;

/// <summary>
/// Refuses to start a DEVELOPMENT process that is pointed at a non-local SQL
/// Server. There are three live production databases behind this repository
/// (see docs/ENVIRONMENTS.md) and read-only credentials for them are meant to
/// be used from a SQL client for investigation — never as the running app's
/// connection. A stray environment variable or a pasted connection string is
/// otherwise indistinguishable from a correct one until something is written.
///
/// The test is an ALLOWLIST of local hosts, not a blocklist of production
/// ones: a blocklist silently passes the host nobody remembered to add, and
/// the whole point is to fail closed. Anything that is not demonstrably this
/// machine is refused.
///
/// It runs only when the environment is Development, so no production deploy
/// can be affected by it. The deliberate escape hatch for a controlled
/// diagnostic session is:
///
///     LocalSafety__AllowRemoteSqlInDevelopment=true
///
/// which is loud, temporary, and has to be typed on purpose.
/// </summary>
public static class DevelopmentSqlGuard
{
    public const string AllowRemoteKey = "LocalSafety:AllowRemoteSqlInDevelopment";

    /// <summary>Throws when <paramref name="connectionString"/> is not a local server.</summary>
    public static void AssertLocal(string? connectionString, string machineName, bool allowRemote)
    {
        if (allowRemote) return;
        if (string.IsNullOrWhiteSpace(connectionString)) return;

        var host = ExtractHost(connectionString);
        if (host is null || IsLocal(host, machineName)) return;

        throw new InvalidOperationException(
            $"REFUSING TO START: ASPNETCORE_ENVIRONMENT=Development but ConnectionStrings:DefaultConnection " +
            $"points at the non-local SQL Server '{host}'. Local development must run against a local " +
            $"restored copy — see docs/ENVIRONMENTS.md for the branch-to-database map. " +
            $"Production databases are READ-ONLY and are to be queried from a SQL client, never from the app. " +
            $"If this really is an approved diagnostic session, set {AllowRemoteKey}=true " +
            $"(environment variable LocalSafety__AllowRemoteSqlInDevelopment=true).");
    }

    /// <summary>Server/Data Source with the instance name, port and protocol prefix removed.</summary>
    public static string? ExtractHost(string connectionString)
    {
        string dataSource;
        try
        {
            dataSource = new SqlConnectionStringBuilder(connectionString).DataSource ?? "";
        }
        catch (ArgumentException)
        {
            // Unparseable connection string: EF will fail on it with a better
            // message than we could write. Not this guard's job to pre-empt.
            return null;
        }

        if (string.IsNullOrWhiteSpace(dataSource)) return null;

        var host = dataSource.Trim();

        // "tcp:host,1433" / "np:\\\\host\\pipe\\..." — take what follows the protocol.
        var protocol = host.IndexOf(':', StringComparison.Ordinal);
        // LocalDB is written "(localdb)\\MSSQLLocalDB" and has no protocol prefix;
        // guard the split so its leading parenthesis is not mistaken for one.
        if (protocol > 0 && !host.StartsWith('(')) host = host[(protocol + 1)..];

        var comma = host.IndexOf(',', StringComparison.Ordinal);      // port
        if (comma >= 0) host = host[..comma];

        var backslash = host.IndexOf('\\', StringComparison.Ordinal);  // named instance
        if (backslash > 0) host = host[..backslash];

        return host.Trim();
    }

    public static bool IsLocal(string host, string machineName)
    {
        if (host.Length == 0) return true;                       // "" means local default instance

        if (host.StartsWith("(localdb)", StringComparison.OrdinalIgnoreCase)) return true;

        // A named instance on this box is written "MACHINE\\INSTANCE"; the
        // instance half is already stripped by the time we get here.
        if (string.Equals(host, machineName, StringComparison.OrdinalIgnoreCase)) return true;

        // The machine's own fully-qualified name still names this machine.
        var firstLabel = host.Split('.')[0];
        if (string.Equals(firstLabel, machineName, StringComparison.OrdinalIgnoreCase)) return true;

        return host switch
        {
            "." or "(local)" or "localhost" or "127.0.0.1" or "::1" or "[::1]" => true,
            _ => false
        };
    }
}
