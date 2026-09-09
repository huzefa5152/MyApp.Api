using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using MyApp.Api.Helpers;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Design-time context for `dotnet ef`. It does NOT run Program.cs, so the
    /// branch-to-database map has to be applied here as well — otherwise
    /// `dotnet ef database update` on one branch would migrate another
    /// environment's database, which is the exact accident the map exists to
    /// prevent. See docs/ENVIRONMENTS.md.
    /// </summary>
    public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
    {
        // Only reached when the branch is unmapped and no override is given —
        // e.g. running `dotnet ef` from outside a checkout. Kept so a stray
        // invocation still has somewhere local to point.
        private const string Fallback =
            "Server=CRKRL-HUSSAHUZ1\\MSSQLSERVER2;Database=DeliveryChallanDb;Trusted_Connection=True;TrustServerCertificate=True;";

        public AppDbContext CreateDbContext(string[] args)
        {
            var optionsBuilder = new DbContextOptionsBuilder<AppDbContext>();

            // Same precedence as the running app: an explicit override first,
            // then the branch, then the fallback.
            var explicitOverride = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");
            var connectionString =
                !string.IsNullOrWhiteSpace(explicitOverride) ? explicitOverride
                : LocalDevDatabase.Resolve(Directory.GetCurrentDirectory()).ConnectionString
                  ?? Fallback;

            // `dotnet ef database update` writes schema, so pointing it at a
            // production server is worse than pointing the app there.
            var allowRemote = string.Equals(
                Environment.GetEnvironmentVariable("LocalSafety__AllowRemoteSqlInDevelopment"),
                "true", StringComparison.OrdinalIgnoreCase);
            DevelopmentSqlGuard.AssertLocal(connectionString, Environment.MachineName, allowRemote);

            optionsBuilder.UseSqlServer(connectionString);

            return new AppDbContext(optionsBuilder.Options);
        }
    }
}
