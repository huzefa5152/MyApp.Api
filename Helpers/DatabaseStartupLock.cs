using Microsoft.Data.SqlClient;

namespace MyApp.Api.Helpers;

/// <summary>Serialize database initialization across worker processes without wrapping nested seed transactions.</summary>
public sealed class DatabaseStartupLock : IAsyncDisposable
{
    private const string Resource = "MyApp.Api.DatabaseInitialization";
    private readonly SqlConnection connection;
    private DatabaseStartupLock(SqlConnection connection) => this.connection = connection;

    public static async Task<DatabaseStartupLock> AcquireAsync(string connectionString)
    {
        var connection = new SqlConnection(connectionString);
        try
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandTimeout = 125;
            command.CommandText = "DECLARE @result int; EXEC @result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive', @LockOwner='Session', @LockTimeout=120000; SELECT @result;";
            command.Parameters.AddWithValue("@resource", Resource);
            if (Convert.ToInt32(await command.ExecuteScalarAsync()) < 0)
                throw new InvalidOperationException("Could not acquire the database initialization lock.");
            return new DatabaseStartupLock(connection);
        }
        catch { await connection.DisposeAsync(); throw; }
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "EXEC sys.sp_releaseapplock @Resource=@resource, @LockOwner='Session';";
            command.Parameters.AddWithValue("@resource", Resource);
            await command.ExecuteNonQueryAsync();
        }
        finally { await connection.DisposeAsync(); }
    }
}
