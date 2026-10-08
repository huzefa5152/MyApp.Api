using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailWorkspaceEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    EnquiryId = table.Column<int>(type: "int", nullable: true),
                    Action = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Timestamp = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailWorkspaceEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GmailConnections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OwnerUserId = table.Column<int>(type: "int", nullable: false),
                    GoogleSubject = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                    EmailAddress = table.Column<string>(type: "nvarchar(320)", maxLength: 320, nullable: false),
                    ProtectedRefreshToken = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(24)", maxLength: 24, nullable: false),
                    LastError = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    BackfillSince = table.Column<DateTime>(type: "datetime2", nullable: false),
                    PageToken = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    HistoryId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    BackfillComplete = table.Column<bool>(type: "bit", nullable: false),
                    LastSyncedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    SyncLeaseUntil = table.Column<DateTime>(type: "datetime2", nullable: true),
                    SyncLeaseId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    NextSyncAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GmailConnections", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GmailOAuthRequests",
                columns: table => new
                {
                    StateHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ProtectedVerifier = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Used = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GmailOAuthRequests", x => x.StateHash);
                });

            migrationBuilder.CreateTable(
                name: "GmailCompanyLinks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ConnectionId = table.Column<int>(type: "int", nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ShareMatchingEmails = table.Column<bool>(type: "bit", nullable: false),
                    IsEnabled = table.Column<bool>(type: "bit", nullable: false),
                    RulesJson = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GmailCompanyLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GmailCompanyLinks_GmailConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalTable: "GmailConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GmailMessages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ConnectionId = table.Column<int>(type: "int", nullable: false),
                    ProviderMessageId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    ThreadId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    Sender = table.Column<string>(type: "nvarchar(320)", maxLength: 320, nullable: false),
                    Subject = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: false),
                    ReceivedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ProtectedContent = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GmailMessages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GmailMessages_GmailConnections_ConnectionId",
                        column: x => x.ConnectionId,
                        principalTable: "GmailConnections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EmailEnquiries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    MessageId = table.Column<int>(type: "int", nullable: false),
                    Decision = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    ProtectedDraft = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SalesQuoteId = table.Column<int>(type: "int", nullable: true),
                    SalesQuoteNumber = table.Column<int>(type: "int", nullable: true),
                    DecidedByUserId = table.Column<int>(type: "int", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Revision = table.Column<Guid>(type: "uniqueidentifier", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailEnquiries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmailEnquiries_GmailMessages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "GmailMessages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailEnquiries_CompanyId_MessageId",
                table: "EmailEnquiries",
                columns: new[] { "CompanyId", "MessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmailEnquiries_MessageId",
                table: "EmailEnquiries",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_EmailWorkspaceEvents_CompanyId_Timestamp",
                table: "EmailWorkspaceEvents",
                columns: new[] { "CompanyId", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_GmailCompanyLinks_ConnectionId_CompanyId",
                table: "GmailCompanyLinks",
                columns: new[] { "ConnectionId", "CompanyId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GmailConnections_OwnerUserId_GoogleSubject",
                table: "GmailConnections",
                columns: new[] { "OwnerUserId", "GoogleSubject" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GmailConnections_Status_NextSyncAt",
                table: "GmailConnections",
                columns: new[] { "Status", "NextSyncAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GmailMessages_ConnectionId_ProviderMessageId",
                table: "GmailMessages",
                columns: new[] { "ConnectionId", "ProviderMessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GmailMessages_ConnectionId_ReceivedAt",
                table: "GmailMessages",
                columns: new[] { "ConnectionId", "ReceivedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmailEnquiries");

            migrationBuilder.DropTable(
                name: "EmailWorkspaceEvents");

            migrationBuilder.DropTable(
                name: "GmailCompanyLinks");

            migrationBuilder.DropTable(
                name: "GmailOAuthRequests");

            migrationBuilder.DropTable(
                name: "GmailMessages");

            migrationBuilder.DropTable(
                name: "GmailConnections");
        }
    }
}
