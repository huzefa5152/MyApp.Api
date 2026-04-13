using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFbrLookupTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FbrLookups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Category = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FbrLookups", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "FbrLookups",
                columns: new[] { "Id", "Category", "Code", "IsActive", "Label", "SortOrder" },
                values: new object[,]
                {
                    { 1, "Province", "7", true, "Punjab", 1 },
                    { 2, "Province", "8", true, "Sindh", 2 },
                    { 3, "Province", "9", true, "KPK", 3 },
                    { 4, "Province", "10", true, "Balochistan", 4 },
                    { 5, "Province", "11", true, "Islamabad", 5 },
                    { 6, "Province", "12", true, "AJK", 6 },
                    { 7, "Province", "13", true, "GB", 7 },
                    { 8, "BusinessActivity", "Manufacturer", true, "Manufacturer", 1 },
                    { 9, "BusinessActivity", "Importer", true, "Importer", 2 },
                    { 10, "BusinessActivity", "Distributor", true, "Distributor", 3 },
                    { 11, "BusinessActivity", "Wholesaler", true, "Wholesaler", 4 },
                    { 12, "BusinessActivity", "Exporter", true, "Exporter", 5 },
                    { 13, "BusinessActivity", "Retailer", true, "Retailer", 6 },
                    { 14, "BusinessActivity", "Service Provider", true, "Service Provider", 7 },
                    { 15, "BusinessActivity", "Other", true, "Other", 8 },
                    { 16, "Sector", "All Other Sectors", true, "All Other Sectors", 1 },
                    { 17, "Sector", "Steel", true, "Steel", 2 },
                    { 18, "Sector", "FMCG", true, "FMCG", 3 },
                    { 19, "Sector", "Textile", true, "Textile", 4 },
                    { 20, "Sector", "Telecom", true, "Telecom", 5 },
                    { 21, "Sector", "Petroleum", true, "Petroleum", 6 },
                    { 22, "Sector", "Electricity Distribution", true, "Electricity Distribution", 7 },
                    { 23, "Sector", "Gas Distribution", true, "Gas Distribution", 8 },
                    { 24, "Sector", "Services", true, "Services", 9 },
                    { 25, "Sector", "Automobile", true, "Automobile", 10 },
                    { 26, "Sector", "CNG Stations", true, "CNG Stations", 11 },
                    { 27, "Sector", "Pharmaceuticals", true, "Pharmaceuticals", 12 },
                    { 28, "Sector", "Wholesale / Retails", true, "Wholesale / Retails", 13 },
                    { 29, "RegistrationType", "Registered", true, "Registered", 1 },
                    { 30, "RegistrationType", "Unregistered", true, "Unregistered", 2 },
                    { 31, "RegistrationType", "FTN", true, "FTN", 3 },
                    { 32, "RegistrationType", "CNIC", true, "CNIC", 4 },
                    { 33, "Environment", "sandbox", true, "Sandbox", 1 },
                    { 34, "Environment", "production", true, "Production", 2 },
                    { 35, "DocumentType", "4", true, "Sale Invoice", 1 },
                    { 36, "DocumentType", "9", true, "Debit Note", 2 },
                    { 37, "DocumentType", "10", true, "Credit Note", 3 },
                    { 38, "PaymentMode", "Cash", true, "Cash", 1 },
                    { 39, "PaymentMode", "Credit", true, "Credit", 2 },
                    { 40, "PaymentMode", "Bank Transfer", true, "Bank Transfer", 3 },
                    { 41, "PaymentMode", "Cheque", true, "Cheque", 4 },
                    { 42, "PaymentMode", "Online", true, "Online", 5 }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FbrLookups");
        }
    }
}
