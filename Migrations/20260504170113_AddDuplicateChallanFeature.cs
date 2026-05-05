using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDuplicateChallanFeature : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Fully idempotent — every step checks DB state before acting so
            // the migration is safe in three scenarios:
            //   (1) Fresh DB:           creates everything from scratch.
            //   (2) Prod DB w/ legacy:  drops the out-of-band UNIQUE index on
            //                           (CompanyId, ChallanNumber) and recreates
            //                           it as non-unique.
            //   (3) DB already touched: e.g. a dev DB shared with master where
            //                           those master-branch migrations already
            //                           added the column + indexes + FK under
            //                           similar names; we skip what's there and
            //                           only fill in gaps.

            // Drop the legacy UNIQUE variant if it's still around. Whether it
            // gets recreated as non-unique below is decided by the next block.
            migrationBuilder.Sql(@"
                IF EXISTS (
                    SELECT 1 FROM sys.indexes i
                    WHERE i.name = 'IX_DeliveryChallans_CompanyId_ChallanNumber'
                      AND i.object_id = OBJECT_ID('dbo.DeliveryChallans')
                      AND i.is_unique = 1
                )
                BEGIN
                    DROP INDEX [IX_DeliveryChallans_CompanyId_ChallanNumber] ON [dbo].[DeliveryChallans];
                END
            ");

            // Add DuplicatedFromId column only if missing.
            migrationBuilder.Sql(@"
                IF NOT EXISTS (
                    SELECT 1 FROM sys.columns
                    WHERE Name = 'DuplicatedFromId'
                      AND Object_ID = OBJECT_ID('dbo.DeliveryChallans')
                )
                BEGIN
                    ALTER TABLE [dbo].[DeliveryChallans] ADD [DuplicatedFromId] int NULL;
                END
            ");

            // Non-unique composite index for paging / MAX queries.
            migrationBuilder.Sql(@"
                IF NOT EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE name = 'IX_DeliveryChallans_CompanyId_ChallanNumber'
                      AND object_id = OBJECT_ID('dbo.DeliveryChallans')
                )
                BEGIN
                    CREATE INDEX [IX_DeliveryChallans_CompanyId_ChallanNumber]
                        ON [dbo].[DeliveryChallans] ([CompanyId], [ChallanNumber]);
                END
            ");

            // Lookup index on the self-FK column.
            migrationBuilder.Sql(@"
                IF NOT EXISTS (
                    SELECT 1 FROM sys.indexes
                    WHERE name = 'IX_DeliveryChallans_DuplicatedFromId'
                      AND object_id = OBJECT_ID('dbo.DeliveryChallans')
                )
                BEGIN
                    CREATE INDEX [IX_DeliveryChallans_DuplicatedFromId]
                        ON [dbo].[DeliveryChallans] ([DuplicatedFromId]);
                END
            ");

            // Self-FK constraint, ON DELETE RESTRICT.
            migrationBuilder.Sql(@"
                IF NOT EXISTS (
                    SELECT 1 FROM sys.foreign_keys
                    WHERE name = 'FK_DeliveryChallans_DeliveryChallans_DuplicatedFromId'
                      AND parent_object_id = OBJECT_ID('dbo.DeliveryChallans')
                )
                BEGIN
                    ALTER TABLE [dbo].[DeliveryChallans]
                        ADD CONSTRAINT [FK_DeliveryChallans_DeliveryChallans_DuplicatedFromId]
                        FOREIGN KEY ([DuplicatedFromId])
                        REFERENCES [dbo].[DeliveryChallans] ([Id])
                        ON DELETE NO ACTION;
                END
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_DeliveryChallans_DuplicatedFromId",
                table: "DeliveryChallans");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_CompanyId_ChallanNumber",
                table: "DeliveryChallans");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_DuplicatedFromId",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "DuplicatedFromId",
                table: "DeliveryChallans");
        }
    }
}
