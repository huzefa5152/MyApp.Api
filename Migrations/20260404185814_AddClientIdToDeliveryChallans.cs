using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddClientIdToDeliveryChallans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Add ClientId to DeliveryChallans (idempotent - may already exist)
            migrationBuilder.Sql(@"
                IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('DeliveryChallans') AND name = 'ClientName')
                BEGIN
                    ALTER TABLE DeliveryChallans DROP COLUMN ClientName;
                END

                IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('DeliveryChallans') AND name = 'ClientId')
                BEGIN
                    ALTER TABLE DeliveryChallans ADD ClientId int NOT NULL DEFAULT 0;
                END

                IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DeliveryChallans_ClientId' AND object_id = OBJECT_ID('DeliveryChallans'))
                BEGIN
                    CREATE INDEX IX_DeliveryChallans_ClientId ON DeliveryChallans (ClientId);
                END

                IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DeliveryChallans_Clients_ClientId')
                BEGIN
                    ALTER TABLE DeliveryChallans ADD CONSTRAINT FK_DeliveryChallans_Clients_ClientId
                        FOREIGN KEY (ClientId) REFERENCES Clients(Id) ON DELETE NO ACTION;
                END
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
