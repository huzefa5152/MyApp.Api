using Microsoft.EntityFrameworkCore;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent creation of the <c>ParserFeedbacks</c> table in raw SQL rather
    /// than an EF migration. This keeps the entire parser-feedback feature in
    /// isolated files: it never touches the EF migration snapshot or history
    /// chain, so the commit cherry-picks between <c>master</c> and
    /// <c>customize-solution-for-other</c> with no schema conflicts. Safe to run
    /// on every startup — the guard is a single <c>IF NOT EXISTS</c>. Mirrors the
    /// runtime-schema pattern already used in Program.cs (see CLAUDE.md §11).
    /// </summary>
    public static class ParserFeedbackSchema
    {
        public static void EnsureCreated(AppDbContext db)
        {
            // Single self-contained CREATE TABLE with table-level inline index
            // definitions (SQL Server 2014+). Keeping the indexes INSIDE the
            // CREATE avoids the parse-time trap where a later statement in the
            // same batch references an object/column created earlier in the
            // batch (CLAUDE.md §11) — there is only one statement here.
            db.Database.ExecuteSqlRaw(@"
                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ParserFeedbacks')
                CREATE TABLE [ParserFeedbacks] (
                    [Id]                  INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_ParserFeedbacks] PRIMARY KEY,
                    [PurchaseOrderId]     INT NULL,
                    [CompanyId]           INT NULL,
                    [OriginalFileName]    NVARCHAR(255) NULL,
                    [OriginalPdfLocation] NVARCHAR(500) NULL,
                    [FileSizeBytes]       BIGINT NOT NULL CONSTRAINT [DF_ParserFeedbacks_FileSizeBytes] DEFAULT(0),
                    [ParserVersion]       NVARCHAR(100) NULL,
                    [FeedbackStatus]      INT NOT NULL,
                    [CreatedBy]           NVARCHAR(256) NULL,
                    [CreatedDate]         DATETIME2 NOT NULL,
                    INDEX [IX_ParserFeedbacks_FeedbackStatus] ([FeedbackStatus]),
                    INDEX [IX_ParserFeedbacks_CreatedDate] ([CreatedDate])
                );
            ");
        }
    }
}
