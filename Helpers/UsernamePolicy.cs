using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MyApp.Api.Helpers;

public static class UsernamePolicy
{
    public const string UnavailableMessage = "This username is unavailable. Choose another username.";

    // Apply only to new or changed names; existing credentials remain valid.
    public static string? Validate(string username) =>
        string.IsNullOrWhiteSpace(username) || username.Length > 100 || username.Any(char.IsControl)
            ? "Enter a username of 1 to 100 characters without control characters." : null;

    public static bool IsConflict(Exception exception) =>
        exception is DbUpdateException { InnerException: SqlException sql }
        && sql.Errors.Cast<SqlError>().Any(error => error.Number is 2601 or 2627
            && error.Message.Contains("IX_Users_Username", StringComparison.OrdinalIgnoreCase));
}
