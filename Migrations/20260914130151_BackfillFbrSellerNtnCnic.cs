using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <summary>
    /// Data-only. States, for every company already filing with FBR, the value
    /// it is ALREADY filing under — so the new required field arrives populated
    /// and nothing about their submissions changes.
    ///
    /// Before <c>Company.FbrSellerNtnCnic</c> existed the number was derived:
    /// the 13-digit CNIC when set, otherwise the NTN
    /// (<c>Helpers/FbrSellerIdentity</c>). This copies that same derived answer
    /// into the column. It is deliberately limited to the CNIC case, which is
    /// what every configured company uses: an NTN needs the letter-aware
    /// 7-character reduction, and doing that in T-SQL would be a second, worse
    /// copy of a rule that already exists in one place. A company the backfill
    /// does not reach simply gets asked for the value the next time its FBR
    /// settings are saved — which is the point of making it explicit.
    ///
    /// Untouched: companies with FBR off (nothing to file), and any company that
    /// has already stated a value.
    /// </summary>
    public partial class BackfillFbrSellerNtnCnic : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                UPDATE Companies
                SET FbrSellerNtnCnic = REPLACE(REPLACE(REPLACE(CNIC, '-', ''), ' ', ''), '.', '')
                WHERE FbrEnabled = 1
                  AND (FbrSellerNtnCnic IS NULL OR LTRIM(RTRIM(FbrSellerNtnCnic)) = '')
                  AND CNIC IS NOT NULL
                  AND LEN(REPLACE(REPLACE(REPLACE(CNIC, '-', ''), ' ', ''), '.', '')) = 13
                  AND REPLACE(REPLACE(REPLACE(CNIC, '-', ''), ' ', ''), '.', '') NOT LIKE '%[^0-9]%';
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Only clears rows this migration could have written: the stated
            // value still equals the CNIC it was copied from.
            migrationBuilder.Sql(@"
                UPDATE Companies
                SET FbrSellerNtnCnic = NULL
                WHERE FbrSellerNtnCnic IS NOT NULL
                  AND FbrSellerNtnCnic = REPLACE(REPLACE(REPLACE(ISNULL(CNIC,''), '-', ''), ' ', ''), '.', '');
            ");
        }
    }
}
