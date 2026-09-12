namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// The one built-in mapping for the <c>GdRows</c> layout (a customs GD
    /// costing sheet — see <see cref="GdCostingMapping"/>).
    ///
    /// Lives here, beside the mapping, rather than in
    /// <c>Helpers/DefaultImportLayouts.cs</c>, so the offline harness
    /// (<c>scripts/gd_costing_harness</c>) can link the JSON without dragging
    /// <c>AppDbContext</c>/EF Core into a console project.
    /// <c>DefaultImportLayouts</c> references this same constant when it seeds
    /// the <c>GdCosting</c> import profile.
    ///
    /// Column numbers are the Alpha / PAK order (they agree); AY's extra
    /// PNL/FIN column, which shifts everything from Subtotal rightwards by
    /// one, is absorbed by <see cref="GdCostingMapping.HeaderAliases"/> rather
    /// than by a second layout.
    /// </summary>
    public static class GdCostingLayout
    {
        public const string MappingJson = """
        {
          "headerRow": 1,
          "firstDataRow": 3,
          "columns": {
            "gdNumber": 1, "gdDate": 2, "description": 3, "quantity": 4,
            "unit": 5, "hsCode": 6, "assessedValue": 7, "customsDuty": 8,
            "acd": 9, "regulatoryDuty": 10, "salesTaxRate": 12, "astRate": 14,
            "others": 16, "incomeTaxRate": 19, "addOnProfit": 22,
            "sellingValue": 23
          },
          "headerAliases": {
            "gdNumber":      ["GD Num", "GD Number", "GDs No"],
            "gdDate":        ["GD Date"],
            "description":   ["Description", "Items"],
            "quantity":      ["Qty"],
            "unit":          ["Unit"],
            "hsCode":        ["HS Code"],
            "assessedValue": ["Assessed Value"],
            "customsDuty":   ["C.Duty"],
            "acd":           ["ACD"],
            "regulatoryDuty":["RD"],
            "others":        ["Others"],
            "salesTaxRate":  ["Assessement", "ST Rate", "S.T Rate"],
            "astRate":       ["AST Rate"],
            "incomeTaxRate": ["I.tax Rate"],
            "addOnProfit":   ["Add On Profit if Need"],
            "sellingValue":  ["Selling Value"]
          }
        }
        """;
    }
}
