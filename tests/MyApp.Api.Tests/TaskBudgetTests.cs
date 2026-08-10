using System;
using System.Threading.Tasks;
using MyApp.Api.Helpers;
using Xunit;

namespace MyApp.Api.Tests;

// Audit H-9: the enrichment budget must return the value when the task
// finishes in time, signal "not completed" when the budget elapses first,
// and propagate a fault that lands within budget. Deterministic — uses
// already-completed / already-faulted tasks plus one large-margin delay.
public class TaskBudgetTests
{
    [Fact]
    public async Task CompletedInTime_ReturnsResult()
    {
        var (completed, result) = await TaskBudget.WaitAsync(Task.FromResult(42), TimeSpan.FromSeconds(5));
        Assert.True(completed);
        Assert.Equal(42, result);
    }

    [Fact]
    public async Task BudgetElapses_ReturnsNotCompleted()
    {
        // 10s task under a 50ms budget: the budget wins by a 200x margin,
        // so the outcome is deterministic, not timing-flaky.
        var slow = Task.Delay(TimeSpan.FromSeconds(10)).ContinueWith(_ => 7);
        var (completed, result) = await TaskBudget.WaitAsync(slow, TimeSpan.FromMilliseconds(50));
        Assert.False(completed);
        Assert.Equal(0, result); // default(int)
    }

    [Fact]
    public async Task FaultWithinBudget_Propagates()
    {
        var faulted = Task.FromException<int>(new InvalidOperationException("boom"));
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => TaskBudget.WaitAsync(faulted, TimeSpan.FromSeconds(5)));
    }
}
