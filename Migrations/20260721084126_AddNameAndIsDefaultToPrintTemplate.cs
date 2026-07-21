using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <summary>
    /// Turns PrintTemplate from single-template-per-(CompanyId, TemplateType) into
    /// multi-template with a per-type default: adds Name + IsDefault, swaps the old
    /// unique (CompanyId, TemplateType) index for a non-unique lookup + a filtered
    /// unique "one default per type" index.
    ///
    /// Authored as IDEMPOTENT guarded SQL rather than the raw EF operations because
    /// the branch dev DB (db46684) already carries this schema from an earlier
    /// customer-branch run (Division-era columns + indexes), while true master/prod
    /// (hakimitraders) does not. The guards make it a genuine ADD where the columns
    /// are missing and a no-op where they already exist. EF ignores the extra
    /// (customer-era) DivisionId column at runtime — it is unmapped and left alone.
    /// (See CLAUDE.md §11 — column-dependent statements are wrapped in EXEC so they
    /// parse only at execution, after the ALTER in the same batch has run.)
    /// </summary>
    public partial class AddNameAndIsDefaultToPrintTemplate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. Name column (default 'Default' backfills existing single templates).
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[PrintTemplates]') AND name = 'Name')
    ALTER TABLE [PrintTemplates] ADD [Name] nvarchar(200) NOT NULL
        CONSTRAINT [DF_PrintTemplates_Name] DEFAULT (N'Default');
");

            // 2. IsDefault column + backfill (only when freshly added, so we never
            //    flip an existing multi-template DB's defaults). On a true single-
            //    template DB every (CompanyId, TemplateType) has exactly one row, so
            //    marking them all default yields exactly one default per type.
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[PrintTemplates]') AND name = 'IsDefault')
BEGIN
    ALTER TABLE [PrintTemplates] ADD [IsDefault] bit NOT NULL
        CONSTRAINT [DF_PrintTemplates_IsDefault] DEFAULT (CAST(0 AS bit));
    EXEC('UPDATE [PrintTemplates] SET [IsDefault] = 1');
END
");

            // 3. Drop the old UNIQUE (CompanyId, TemplateType) index if present.
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PrintTemplates_CompanyId_TemplateType'
           AND object_id = OBJECT_ID(N'[dbo].[PrintTemplates]') AND is_unique = 1)
    DROP INDEX [IX_PrintTemplates_CompanyId_TemplateType] ON [PrintTemplates];
");

            // 4. Non-unique lookup index on (CompanyId, TemplateType).
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PrintTemplates_CompanyId_TemplateType'
               AND object_id = OBJECT_ID(N'[dbo].[PrintTemplates]'))
    CREATE INDEX [IX_PrintTemplates_CompanyId_TemplateType] ON [PrintTemplates] ([CompanyId], [TemplateType]);
");

            // 5. Filtered unique "one default per type" index. Skipped on db46684 where
            //    an equivalent (customer-era, division-keyed) index already exists —
            //    with all master rows at DivisionId = NULL it enforces the same rule.
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PrintTemplates_DefaultPerScope'
               AND object_id = OBJECT_ID(N'[dbo].[PrintTemplates]'))
    CREATE UNIQUE INDEX [UX_PrintTemplates_DefaultPerScope] ON [PrintTemplates] ([CompanyId], [TemplateType])
        WHERE [IsDefault] = 1;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PrintTemplates_DefaultPerScope' AND object_id = OBJECT_ID(N'[dbo].[PrintTemplates]'))
    DROP INDEX [UX_PrintTemplates_DefaultPerScope] ON [PrintTemplates];
");
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PrintTemplates_CompanyId_TemplateType' AND object_id = OBJECT_ID(N'[dbo].[PrintTemplates]') AND is_unique = 0)
    DROP INDEX [IX_PrintTemplates_CompanyId_TemplateType] ON [PrintTemplates];
");
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[PrintTemplates]') AND name = 'IsDefault')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_PrintTemplates_IsDefault')
        ALTER TABLE [PrintTemplates] DROP CONSTRAINT [DF_PrintTemplates_IsDefault];
    ALTER TABLE [PrintTemplates] DROP COLUMN [IsDefault];
END
");
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[PrintTemplates]') AND name = 'Name')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_PrintTemplates_Name')
        ALTER TABLE [PrintTemplates] DROP CONSTRAINT [DF_PrintTemplates_Name];
    ALTER TABLE [PrintTemplates] DROP COLUMN [Name];
END
");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PrintTemplates_CompanyId_TemplateType' AND object_id = OBJECT_ID(N'[dbo].[PrintTemplates]'))
    CREATE UNIQUE INDEX [IX_PrintTemplates_CompanyId_TemplateType] ON [PrintTemplates] ([CompanyId], [TemplateType]);
");
        }
    }
}
