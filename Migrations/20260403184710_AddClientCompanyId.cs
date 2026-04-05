using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddClientCompanyId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Create Clients table if it doesn't exist (it may have been created outside of migrations)
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Clients')
                BEGIN
                    CREATE TABLE [Clients] (
                        [Id] int NOT NULL IDENTITY(1,1),
                        [Name] nvarchar(max) NOT NULL,
                        [Address] nvarchar(max) NULL,
                        [Phone] nvarchar(max) NULL,
                        [Email] nvarchar(max) NULL,
                        [CreatedAt] datetime2 NOT NULL DEFAULT GETUTCDATE(),
                        CONSTRAINT [PK_Clients] PRIMARY KEY ([Id])
                    );
                END
            ");

            // Add CompanyId column if it doesn't exist
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'CompanyId')
                BEGIN
                    ALTER TABLE [Clients] ADD [CompanyId] int NOT NULL DEFAULT 0;
                END
            ");

            // Assign existing clients to the first company
            migrationBuilder.Sql(
                "UPDATE Clients SET CompanyId = (SELECT TOP 1 Id FROM Companies ORDER BY Id) WHERE CompanyId = 0");

            // Add index if it doesn't exist
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Clients_CompanyId')
                BEGIN
                    CREATE INDEX [IX_Clients_CompanyId] ON [Clients] ([CompanyId]);
                END
            ");

            // Add FK if it doesn't exist
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Clients_Companies_CompanyId')
                BEGIN
                    ALTER TABLE [Clients] ADD CONSTRAINT [FK_Clients_Companies_CompanyId]
                        FOREIGN KEY ([CompanyId]) REFERENCES [Companies] ([Id]) ON DELETE NO ACTION;
                END
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Clients_Companies_CompanyId",
                table: "Clients");

            migrationBuilder.DropIndex(
                name: "IX_Clients_CompanyId",
                table: "Clients");

            migrationBuilder.DropColumn(
                name: "CompanyId",
                table: "Clients");
        }
    }
}
