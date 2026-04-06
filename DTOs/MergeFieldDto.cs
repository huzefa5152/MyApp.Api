namespace MyApp.Api.DTOs
{
    public class MergeFieldDto
    {
        public int Id { get; set; }
        public string TemplateType { get; set; } = "";
        public string FieldExpression { get; set; } = "";
        public string Label { get; set; } = "";
        public string? Category { get; set; }
        public int SortOrder { get; set; }
    }
}
