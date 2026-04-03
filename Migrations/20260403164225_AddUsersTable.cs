using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddUsersTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Create Users table if it doesn't exist (was no-op locally but needed on production)
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
                BEGIN
                    CREATE TABLE [Users] (
                        [Id] int NOT NULL IDENTITY,
                        [Username] nvarchar(450) NOT NULL,
                        [PasswordHash] nvarchar(max) NOT NULL,
                        [FullName] nvarchar(max) NOT NULL,
                        [Role] nvarchar(max) NOT NULL,
                        [CreatedAt] datetime2 NOT NULL,
                        CONSTRAINT [PK_Users] PRIMARY KEY ([Id])
                    );
                    CREATE UNIQUE INDEX [IX_Users_Username] ON [Users] ([Username]);

                    -- Seed default admin user (password: admin123)
                    INSERT INTO [Users] ([Username], [PasswordHash], [FullName], [Role], [CreatedAt])
                    VALUES (N'admin', N'$2a$11$ITxobMb6Kk7r4cjBAN3tF.U2x5q/PpaueP/1dvUSr6V0N5z724cuu', N'Administrator', N'Admin', '2025-01-01T00:00:00.0000000');
                END
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "Users");
        }
    }
}
