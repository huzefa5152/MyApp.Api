using MyApp.Api.Helpers;
using MyApp.Api.Data;
using Microsoft.EntityFrameworkCore;
using Xunit;
namespace MyApp.Api.Tests;
public class EmailModuleTests
{
    [Fact]
    public void EmailModuleRequiresItsOwnRoleInsteadOfExistingEditions()
    {
        Assert.Contains("email.workspace.use", EditionCatalog.EmailWorkspaceKeys);
        Assert.Contains("email.connections.manage", EditionCatalog.EmailWorkspaceKeys);
        Assert.DoesNotContain(EditionCatalog.SalesEditionKeys, k => k.StartsWith("email."));
        Assert.DoesNotContain(EditionCatalog.CompleteEditionKeys, k => k.StartsWith("email."));
        Assert.DoesNotContain(EditionCatalog.TenantAdminEffectiveKeys, k => k.StartsWith("email."));
        var role = Assert.Single(EditionCatalog.All, r => r.Name == EditionCatalog.EmailWorkspaceRoleName);
        Assert.Equal(EditionCatalog.EmailWorkspaceKeys, role.Keys);
    }

    [Fact]
    [Trait("Category", "LocalSql")]
    public async Task SeederCreatesOptionalRoleWithoutEnablingExistingUsers()
    {
        var connection = Environment.GetEnvironmentVariable("EMAIL_TEST_CONNECTION") ?? throw new InvalidOperationException("Set EMAIL_TEST_CONNECTION to an approved disposable local test database.");
        DevelopmentSqlGuard.AssertLocal(connection, Environment.MachineName, false);
        Assert.StartsWith("MyApp_EmailWorkspace_Test_", new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection).InitialCatalog);
        var scratch = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection);
        scratch.InitialCatalog += "_Module";
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(scratch.ConnectionString).Options);
        await db.Database.EnsureCreatedAsync();
        if (!await db.Users.AnyAsync())
        {
            db.Users.Add(new MyApp.Api.Models.User { Username = "module-test-seed", FullName = "Sample Administrator" });
            await db.SaveChangesAsync();
        }
        {
            await RbacSeeder.SeedAsync(db, 1);
            var optional = await db.Roles.Include(r => r.RolePermissions).ThenInclude(p => p.Permission).SingleAsync(r => r.Name == EditionCatalog.EmailWorkspaceRoleName);
            Assert.True(optional.IsSystemRole);
            Assert.Equal(EditionCatalog.EmailWorkspaceKeys.Order(), optional.RolePermissions.Select(p => p.Permission!.Key).Order());
            Assert.False(await db.UserRoles.AnyAsync(r => r.RoleId == optional.Id));
            foreach (var name in new[] { RbacSeeder.AdministratorRoleName, EditionCatalog.SalesEditionRoleName, EditionCatalog.CompleteEditionRoleName, EditionCatalog.TenantAdminRoleName })
                Assert.False(await db.RolePermissions.AnyAsync(p => p.Role!.Name == name && p.Permission!.Key.StartsWith("email.")));
        }

    }
}
