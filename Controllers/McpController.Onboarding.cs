using System.Text.Json;
namespace MyApp.Api.Controllers;
public partial class McpController
{
    private static void AddOnboardingTools(List<ExpandedTool> tools) { }
    private Task<object> CallOnboardingToolAsync(string name, JsonElement args) => throw new ToolError("Tool unavailable in this installation.");
}
