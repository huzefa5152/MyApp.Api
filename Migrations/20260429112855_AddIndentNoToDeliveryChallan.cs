using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddIndentNoToDeliveryChallan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IndentNo",
                table: "DeliveryChallans",
                type: "nvarchar(max)",
                nullable: true);

            // Surface the new field in the print-template editor's merge-field
            // sidebar. The {{else}} / {{/if}} entries already exist for the
            // Challan type (seeded by AddMergeFields), so they're reused.
            // SortOrder 14 sits between PO Date (13) and Client Name (20);
            // 47 is in the free Conditionals slot (45/46 taken).
            migrationBuilder.InsertData(
                table: "MergeFields",
                columns: new[] { "TemplateType", "FieldExpression", "Label", "Category", "SortOrder" },
                values: new object[,]
                {
                    { "Challan", "{{indentNo}}",     "Indent No",        "Document",     14 },
                    { "Challan", "{{#if indentNo}}", "If: Has Indent No","Conditionals", 47 }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "MergeFields",
                keyColumns: new[] { "TemplateType", "FieldExpression" },
                keyValues: new object[] { "Challan", "{{indentNo}}" });

            migrationBuilder.DeleteData(
                table: "MergeFields",
                keyColumns: new[] { "TemplateType", "FieldExpression" },
                keyValues: new object[] { "Challan", "{{#if indentNo}}" });

            migrationBuilder.DropColumn(
                name: "IndentNo",
                table: "DeliveryChallans");
        }
    }
}
