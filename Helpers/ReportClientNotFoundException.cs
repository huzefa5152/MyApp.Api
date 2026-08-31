using System;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// A <c>clientId</c> supplied to a report does not exist inside the company
    /// the report is scoped to — either unknown, or belonging to a different
    /// tenant. The controller maps it to ONE generic 404 for both cases so a
    /// foreign id can never be told apart from an unknown one.
    ///
    /// It exists as its own type on purpose. The obvious alternative — catching
    /// <see cref="InvalidOperationException"/> in the controller — silently
    /// swallows a whole family of unrelated runtime failures that share that
    /// type: EF's "a second operation was started on this context", LINQ's
    /// "Sequence contains no elements", and every other invalid-state throw. Any
    /// of those would have surfaced to the operator as "Customer not found."
    /// with nothing written to the log, turning an infrastructure fault into a
    /// phantom data problem with no evidence behind it. Catching this type
    /// instead means only the intended case takes the 404 path; everything else
    /// falls through to the logged, generic 500.
    /// </summary>
    public class ReportClientNotFoundException : Exception
    {
        public ReportClientNotFoundException(string message) : base(message) { }
    }
}
