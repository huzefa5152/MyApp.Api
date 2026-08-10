using System;
using MyApp.Api.Helpers;
using Xunit;

namespace MyApp.Api.Tests;

// Audit H-7: the classifier keeps deliberate validation IOEs as caller errors
// (400) while routing framework-internal IOEs to server errors (500). These
// tests pin that boundary so a future edit can't silently re-leak or re-mask.
public class ExceptionClassifierTests
{
    [Theory]
    [InlineData("Challan 5 is not in a billable status (got 'Invoiced').")]
    [InlineData("Client does not belong to this company.")]
    [InlineData("A bill can't be dated in the future.")]
    [InlineData("")] // message-less IOE stays a 400, as it was before H-7
    public void DeliberateValidation_TreatedAsCallerError(string message)
        => Assert.False(ExceptionClassifier.IsFrameworkInternal(new InvalidOperationException(message)));

    [Theory]
    [InlineData("The LINQ expression 'x' could not be translated.")]
    [InlineData("A second operation was started on this context instance before a previous operation completed.")]
    [InlineData("Sequence contains no elements")]
    [InlineData("Sequence contains more than one element")]
    [InlineData("The instance of entity type 'Invoice' cannot be tracked because another instance with the same key value is already being tracked.")]
    [InlineData("Nullable object must have a value.")]
    [InlineData("Collection was modified; enumeration operation may not execute.")]
    public void FrameworkInternal_TreatedAsServerError(string message)
        => Assert.True(ExceptionClassifier.IsFrameworkInternal(new InvalidOperationException(message)));

    [Fact]
    public void ObjectDisposed_IsServerError()
        => Assert.True(ExceptionClassifier.IsFrameworkInternal(new ObjectDisposedException("ctx")));

    [Fact]
    public void CaseInsensitive_MarkerMatch()
        => Assert.True(ExceptionClassifier.IsFrameworkInternal(
            new InvalidOperationException("The LINQ expression COULD NOT BE TRANSLATED.")));
}
