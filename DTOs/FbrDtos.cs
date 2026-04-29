using System.Text.Json.Serialization;

namespace MyApp.Api.DTOs
{
    // ══════════════════════════════════════════════════════════════
    //  FBR Digital Invoicing V1.12 — Request DTOs
    // ══════════════════════════════════════════════════════════════

    public class FbrInvoiceRequest
    {
        public string InvoiceType { get; set; } = "Sale Invoice";
        public string InvoiceDate { get; set; } = "";
        public string SellerNTNCNIC { get; set; } = "";
        public string SellerBusinessName { get; set; } = "";
        public string SellerProvince { get; set; } = "";
        public string SellerAddress { get; set; } = "";
        public string BuyerNTNCNIC { get; set; } = "";
        public string BuyerBusinessName { get; set; } = "";
        public string BuyerProvince { get; set; } = "";
        public string BuyerAddress { get; set; } = "";
        public string BuyerRegistrationType { get; set; } = "";
        public string InvoiceRefNo { get; set; } = "";

        // Only included for sandbox; null → omitted from JSON
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? ScenarioId { get; set; }

        public List<FbrInvoiceItemRequest> Items { get; set; } = new();
    }

    public class FbrInvoiceItemRequest
    {
        public string HsCode { get; set; } = "";
        public string ProductDescription { get; set; } = "";
        public string Rate { get; set; } = "";
        public string UoM { get; set; } = "";
        public decimal Quantity { get; set; }
        public decimal TotalValues { get; set; }
        public decimal ValueSalesExcludingST { get; set; }
        public decimal FixedNotifiedValueOrRetailPrice { get; set; }
        public decimal SalesTaxApplicable { get; set; }
        public decimal SalesTaxWithheldAtSource { get; set; }
        /// <summary>
        /// FBR quirk: for reduced-rate items (SN028) this must serialise as
        /// an empty string "" — sending `0` triggers error [0091] "Extra tax
        /// provided where sale is of reduced rate goods". For every other
        /// scenario it's a plain number. Typed as object so the JSON writer
        /// emits whichever we set.
        /// </summary>
        public object ExtraTax { get; set; } = 0m;
        public decimal FurtherTax { get; set; }
        public string SroScheduleNo { get; set; } = "";
        public decimal FedPayable { get; set; }
        public decimal Discount { get; set; }
        public string SaleType { get; set; } = "";
        public string SroItemSerialNo { get; set; } = "";
    }

    // ══════════════════════════════════════════════════════════════
    //  FBR Digital Invoicing V1.12 — Response DTOs
    // ══════════════════════════════════════════════════════════════

    public class FbrApiResponse
    {
        // IRN — only present in POST (submit) response, null for validate
        public string? InvoiceNumber { get; set; }
        public string? Dated { get; set; }
        public FbrValidationResponse? ValidationResponse { get; set; }
    }

    public class FbrValidationResponse
    {
        public string StatusCode { get; set; } = "";
        public string Status { get; set; } = "";
        public string? ErrorCode { get; set; }
        public string? Error { get; set; }
        public List<FbrInvoiceStatus>? InvoiceStatuses { get; set; }
    }

    public class FbrInvoiceStatus
    {
        public string? ItemSNo { get; set; }
        public string StatusCode { get; set; } = "";
        public string Status { get; set; } = "";
        public string? InvoiceNo { get; set; }   // V1.12: per-item invoice ref (IRN + "-1")
        public string? ErrorCode { get; set; }
        public string? Error { get; set; }
    }

    // ══════════════════════════════════════════════════════════════
    //  FBR Reference Data DTOs (matching V1.12 reference API responses)
    // ══════════════════════════════════════════════════════════════

    public class FbrProvinceDto
    {
        public int StateProvinceCode { get; set; }
        public string StateProvinceDesc { get; set; } = "";
    }

    public class FbrDocTypeDto
    {
        public int DocTypeId { get; set; }
        public string DocDescription { get; set; } = "";
    }

    public class FbrHSCodeDto
    {
        public string HS_CODE { get; set; } = "";
        public string Description { get; set; } = "";
    }

    public class FbrUOMDto
    {
        public int UOM_ID { get; set; }
        public string Description { get; set; } = "";
    }

    public class FbrTransactionTypeDto
    {
        public int TRANSACTION_TYPE_ID { get; set; }
        public string TRANSACTION_DESC { get; set; } = "";
    }

    public class FbrSaleTypeRateDto
    {
        public int RATE_ID { get; set; }
        public string RATE_DESC { get; set; } = "";
        public decimal RATE_VALUE { get; set; }
    }

    public class FbrSRODto
    {
        public int SRO_ID { get; set; }
        public string SRO_DESC { get; set; } = "";
    }

    public class FbrSROItemDto
    {
        public int SRO_ITEM_ID { get; set; }
        public string SRO_ITEM_DESC { get; set; } = "";
    }

    // ══════════════════════════════════════════════════════════════
    //  STATL / Registration Check DTOs (V1.12 §5.11, §5.12)
    // ══════════════════════════════════════════════════════════════

    public class FbrRegStatusDto
    {
        [JsonPropertyName("status code")]
        public string StatusCode { get; set; } = "";
        public string Status { get; set; } = "";
    }

    public class FbrRegTypeDto
    {
        public string Statuscode { get; set; } = "";
        public string REGISTRATION_NO { get; set; } = "";
        public string REGISTRATION_TYPE { get; set; } = "";
    }

    // ══════════════════════════════════════════════════════════════
    //  Internal Result DTO (for our frontend)
    // ══════════════════════════════════════════════════════════════

    public class FbrSubmissionResult
    {
        public bool Success { get; set; }
        public string? IRN { get; set; }
        public string? FbrStatus { get; set; }
        public string? ErrorMessage { get; set; }
        public List<FbrInvoiceStatus>? ItemErrors { get; set; }
        /// <summary>
        /// Populated only when the caller asked for a dry-run preview (the
        /// /api/fbr/{id}/preview-payload endpoint). Carries the exact JSON
        /// the service would have POSTed to FBR's validate or submit
        /// endpoint, so operators can sanity-check the grouping / values
        /// before clicking the real button. Null in normal validate/submit
        /// flows.
        /// </summary>
        public FbrPayloadPreview? Preview { get; set; }
    }

    public class FbrPayloadPreview
    {
        /// <summary>The exact request JSON that would be POSTed to FBR.</summary>
        public string Json { get; set; } = "";
        /// <summary>Endpoint URL we would have POSTed to (sandbox vs prod).</summary>
        public string Url { get; set; } = "";
        /// <summary>Number of items in the FBR payload after grouping.</summary>
        public int ItemCount { get; set; }
        /// <summary>How many bill lines collapsed into the payload (n→1 grouping shows here).</summary>
        public int OriginalLineCount { get; set; }
    }
}
