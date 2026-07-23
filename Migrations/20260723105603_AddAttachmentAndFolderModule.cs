using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAttachmentAndFolderModule : Migration
    {
        // IDEMPOTENT guarded raw SQL (not the generated CreateTable calls). The
        // dev prod-replica DB (db46684) was seeded by an earlier customer-branch
        // run and ALREADY has Folders + Attachments (its Attachments has no
        // DivisionId — matching this Division-free model exactly). A plain
        // CreateTable would throw "table already exists" there. These guards
        // no-op what's present and create everything fresh on a true master/prod
        // DB (hakimitraders — has neither). Mirrors the Payment migration + the
        // Program.cs split-batch pattern (CLAUDE.md §11).
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ParserFeedbacks CreateTable intentionally stripped — that table is
            // raw-SQL-managed (Data/ParserFeedbackSchema.cs at startup) and kept
            // out of migrations + the model snapshot.

            // Folders first (Attachments FK-references it).
            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.Folders','U') IS NULL
BEGIN
    CREATE TABLE dbo.Folders (
        Id int IDENTITY(1,1) NOT NULL,
        CompanyId int NOT NULL,
        Name nvarchar(200) NOT NULL,
        Description nvarchar(1000) NULL,
        CreatedByUserId int NULL,
        CreatedAt datetime2 NOT NULL,
        CONSTRAINT PK_Folders PRIMARY KEY (Id),
        CONSTRAINT FK_Folders_Companies_CompanyId FOREIGN KEY (CompanyId)
            REFERENCES dbo.Companies (Id) ON DELETE CASCADE,
        CONSTRAINT FK_Folders_Users_CreatedByUserId FOREIGN KEY (CreatedByUserId)
            REFERENCES dbo.Users (Id) ON DELETE NO ACTION
    );
END");

            migrationBuilder.Sql(@"
IF OBJECT_ID('dbo.Attachments','U') IS NULL
BEGIN
    CREATE TABLE dbo.Attachments (
        Id int IDENTITY(1,1) NOT NULL,
        CompanyId int NOT NULL,
        FolderId int NULL,
        EntityType nvarchar(40) NULL,
        EntityId int NULL,
        FileName nvarchar(255) NOT NULL,
        StoredFileName nvarchar(100) NOT NULL,
        StoragePath nvarchar(500) NOT NULL,
        ContentType nvarchar(150) NOT NULL,
        FileExtension nvarchar(20) NOT NULL,
        FileSizeBytes bigint NOT NULL,
        ContentSha256 nvarchar(64) NULL,
        UploadedByUserId int NULL,
        CreatedAt datetime2 NOT NULL,
        CONSTRAINT PK_Attachments PRIMARY KEY (Id),
        CONSTRAINT FK_Attachments_Companies_CompanyId FOREIGN KEY (CompanyId)
            REFERENCES dbo.Companies (Id) ON DELETE NO ACTION,
        CONSTRAINT FK_Attachments_Folders_FolderId FOREIGN KEY (FolderId)
            REFERENCES dbo.Folders (Id) ON DELETE NO ACTION,
        CONSTRAINT FK_Attachments_Users_UploadedByUserId FOREIGN KEY (UploadedByUserId)
            REFERENCES dbo.Users (Id) ON DELETE NO ACTION
    );
END");

            // Indexes (guarded; tables now exist either way).
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Folders_CompanyId_Name' AND object_id=OBJECT_ID('dbo.Folders'))
    CREATE UNIQUE INDEX IX_Folders_CompanyId_Name ON dbo.Folders (CompanyId, Name);");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Folders_CreatedByUserId' AND object_id=OBJECT_ID('dbo.Folders'))
    CREATE INDEX IX_Folders_CreatedByUserId ON dbo.Folders (CreatedByUserId);");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Attachments_CompanyId_FolderId' AND object_id=OBJECT_ID('dbo.Attachments'))
    CREATE INDEX IX_Attachments_CompanyId_FolderId ON dbo.Attachments (CompanyId, FolderId);");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Attachments_EntityType_EntityId' AND object_id=OBJECT_ID('dbo.Attachments'))
    CREATE INDEX IX_Attachments_EntityType_EntityId ON dbo.Attachments (EntityType, EntityId);");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Attachments_FolderId' AND object_id=OBJECT_ID('dbo.Attachments'))
    CREATE INDEX IX_Attachments_FolderId ON dbo.Attachments (FolderId);");
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Attachments_UploadedByUserId' AND object_id=OBJECT_ID('dbo.Attachments'))
    CREATE INDEX IX_Attachments_UploadedByUserId ON dbo.Attachments (UploadedByUserId);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // ParserFeedbacks DropTable intentionally stripped (see Up). Guarded
            // drops so Down is safe regardless of what actually got created.
            migrationBuilder.Sql("IF OBJECT_ID('dbo.Attachments','U') IS NOT NULL DROP TABLE dbo.Attachments;");
            migrationBuilder.Sql("IF OBJECT_ID('dbo.Folders','U') IS NOT NULL DROP TABLE dbo.Folders;");
        }
    }
}
