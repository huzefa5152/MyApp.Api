using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDeliveryChallanCreatedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedAt",
                table: "DeliveryChallans",
                type: "datetime2",
                nullable: true);

            // Install the default separately so existing rows remain unknown (NULL).
            migrationBuilder.Sql("ALTER TABLE [DeliveryChallans] ADD CONSTRAINT [DF_DeliveryChallans_CreatedAt] DEFAULT (SYSUTCDATETIME()) FOR [CreatedAt];");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatedAt",
                table: "DeliveryChallans");
        }
    }
}
