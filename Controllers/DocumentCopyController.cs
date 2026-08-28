using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Copy Document — one endpoint pair for every copyable document type.
    ///
    /// Permissions can't be declared with <c>[HasPermission]</c> here because the
    /// key depends on the destination the caller picked, so both actions resolve
    /// it at request time from <see cref="DocumentCopyTypes"/> and check it via
    /// <see cref="IPermissionService"/>. The rule is the strict one: reading the
    /// source needs a view permission for the SOURCE type, and creating the copy
    /// needs the create permission for the DESTINATION type — someone who may
    /// read quotes but not create orders cannot copy a quote into an order.
    /// Tenant and division guards are the same ones every document controller
    /// runs.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/documents")]
    public class DocumentCopyController : ControllerBase
    {
        private readonly IDocumentCopyService _copy;
        private readonly IPermissionService _permissions;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;

        public DocumentCopyController(
            IDocumentCopyService copy,
            IPermissionService permissions,
            ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess)
        {
            _copy = copy;
            _permissions = permissions;
            _access = access;
            _divisionAccess = divisionAccess;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// What this document can be copied into, with each destination flagged
        /// by whether the caller may create it. Drives the copy dialog, so the
        /// operator never sees an option that would 403 on submit.
        /// </summary>
        [HttpGet("{sourceType}/{sourceId:int}/copy-targets")]
        public async Task<ActionResult<CopyTargetsDto>> GetCopyTargets(string sourceType, int sourceId)
        {
            var type = DocumentCopyTypes.Canonical(sourceType);
            if (type == null) return BadRequest(new { error = "Unknown document type." });

            if (!await HasAnyAsync(DocumentCopyTypes.ViewPermissions(type)))
                return Forbid();

            var source = await _copy.GetSourceRefAsync(type, sourceId);
            if (source == null) return NotFound();

            await _access.AssertAccessAsync(CurrentUserId, source.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, source.CompanyId, source.DivisionId);

            var targets = new List<CopyTargetDto>();
            foreach (var destination in DocumentCopyTypes.TargetsFor(type))
            {
                var createKey = DocumentCopyTypes.CreatePermission(destination);
                var allowed = await _permissions.HasPermissionAsync(CurrentUserId, createKey);
                targets.Add(new CopyTargetDto
                {
                    Type = destination,
                    Label = DocumentCopyTypes.Label(destination),
                    IsSameDocument = destination == type,
                    Allowed = allowed,
                    Reason = allowed ? null : $"You don't have permission to create a {DocumentCopyTypes.Label(destination)}.",
                    FixedBehaviourNote = FixedBehaviourNote(type, destination),
                });
            }

            return Ok(new CopyTargetsDto
            {
                SourceType = type,
                SourceTypeLabel = DocumentCopyTypes.Label(type),
                SourceId = source.Id,
                SourceNumber = source.Number,
                CompanyId = source.CompanyId,
                DivisionId = source.DivisionId,
                AttachmentCount = await _copy.GetAttachmentCountAsync(source.CompanyId, type, source.Id),
                Targets = targets,
            });
        }

        /// <summary>
        /// Creates the copy. The new document is produced by the destination's own
        /// service, so it is numbered, validated, posted and stock-adjusted exactly
        /// like one the operator typed.
        /// </summary>
        [HttpPost("copy")]
        public async Task<ActionResult<CopyDocumentResultDto>> Copy([FromBody] CopyDocumentRequestDto dto)
        {
            var sourceType = DocumentCopyTypes.Canonical(dto.SourceType);
            var destinationType = DocumentCopyTypes.Canonical(dto.DestinationType);
            if (sourceType == null || destinationType == null)
                return BadRequest(new { error = "Unknown document type." });
            if (!DocumentCopyTypes.IsSupported(sourceType, destinationType))
                return BadRequest(new
                {
                    error = $"A {DocumentCopyTypes.Label(sourceType)} cannot be copied into a {DocumentCopyTypes.Label(destinationType)}."
                });

            if (!await HasAnyAsync(DocumentCopyTypes.ViewPermissions(sourceType)))
                return Forbid();
            if (!await _permissions.HasPermissionAsync(CurrentUserId, DocumentCopyTypes.CreatePermission(destinationType)))
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = $"Permission denied: requires '{DocumentCopyTypes.CreatePermission(destinationType)}'."
                });

            var source = await _copy.GetSourceRefAsync(sourceType, dto.SourceId);
            if (source == null) return NotFound();

            await _access.AssertAccessAsync(CurrentUserId, source.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, source.CompanyId, source.DivisionId);
            // The copy lands in the source's division, so the caller must be able
            // to WRITE there — the same assert the create endpoints run.
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, source.CompanyId, source.DivisionId);

            try
            {
                var result = await _copy.CopyAsync(dto, CurrentUserId);
                return Ok(result);
            }
            catch (KeyNotFoundException ex) { return NotFound(new { error = ex.Message }); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        private async Task<bool> HasAnyAsync(IReadOnlyList<string> keys)
        {
            foreach (var key in keys)
                if (await _permissions.HasPermissionAsync(CurrentUserId, key))
                    return true;
            return false;
        }

        /// <summary>
        /// Note shown when a destination delegates to an existing conversion whose
        /// semantics the copy options can't change.
        /// </summary>
        private static string? FixedBehaviourNote(string source, string destination)
        {
            if (source == DocumentCopyTypes.SalesQuote && destination == DocumentCopyTypes.SalesOrder)
                return "Uses the existing Convert action: the order is linked to this quote, the quote is marked Accepted, and a quote converts only once.";
            if (source == DocumentCopyTypes.SalesOrder && destination == DocumentCopyTypes.DeliveryChallan)
                return "Quantities default to what is still undelivered on the order.";
            if (source == DocumentCopyTypes.SalesOrder && destination == DocumentCopyTypes.Invoice)
                return "Prices come from the order's agreed rate, then the source quote, then the item's last billed rate.";
            if (source == DocumentCopyTypes.GoodsReceipt && destination == DocumentCopyTypes.PurchaseBill)
                return "A receipt carries no prices, so the bill is created at zero value for you to price.";
            return null;
        }
    }
}
