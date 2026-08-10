using System;
using System.Threading.Tasks;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Audit H-9: run an awaitable under a wall-clock budget so a slow
    /// best-effort dependency (e.g. a PRAL/FBR enrichment call that the
    /// resilience handler retries for ~90s during a brownout) can't hang a
    /// user request. Returns as soon as the budget elapses; the underlying
    /// task is left to finish in the background (its later fault, if any, is
    /// observed so it never surfaces as an UnobservedTaskException).
    ///
    /// Use only for OPTIONAL work whose result the caller can safely skip.
    /// </summary>
    public static class TaskBudget
    {
        /// <summary>
        /// Awaits <paramref name="task"/> for at most <paramref name="budget"/>.
        /// Returns <c>(true, result)</c> when it finishes in time, or
        /// <c>(false, default)</c> when the budget elapses first. A task that
        /// faults within the budget re-throws to the caller.
        /// </summary>
        public static async Task<(bool completed, T? result)> WaitAsync<T>(Task<T> task, TimeSpan budget)
        {
            if (task == null) throw new ArgumentNullException(nameof(task));

            var finished = await Task.WhenAny(task, Task.Delay(budget)).ConfigureAwait(false);
            if (finished != task)
            {
                // Budget elapsed. Observe any eventual fault on the abandoned
                // task so it doesn't bubble up as an UnobservedTaskException.
                _ = task.ContinueWith(t => { _ = t.Exception; }, TaskScheduler.Default);
                return (false, default);
            }

            // Completed within budget — observe the result (re-throws if faulted).
            return (true, await task.ConfigureAwait(false));
        }
    }
}
