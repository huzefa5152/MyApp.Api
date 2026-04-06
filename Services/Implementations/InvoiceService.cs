using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class InvoiceService : IInvoiceService
    {
        private readonly IInvoiceRepository _invoiceRepo;
        private readonly IDeliveryChallanRepository _challanRepo;
        private readonly ICompanyRepository _companyRepo;
        private readonly IClientRepository _clientRepo;

        public InvoiceService(
            IInvoiceRepository invoiceRepo,
            IDeliveryChallanRepository challanRepo,
            ICompanyRepository companyRepo,
            IClientRepository clientRepo)
        {
            _invoiceRepo = invoiceRepo;
            _challanRepo = challanRepo;
            _companyRepo = companyRepo;
            _clientRepo = clientRepo;
        }

        private static InvoiceDto ToDto(Invoice inv) => new()
        {
            Id = inv.Id,
            InvoiceNumber = inv.InvoiceNumber,
            Date = inv.Date,
            CompanyId = inv.CompanyId,
            CompanyName = inv.Company?.Name ?? "",
            ClientId = inv.ClientId,
            ClientName = inv.Client?.Name ?? "",
            Subtotal = inv.Subtotal,
            GSTRate = inv.GSTRate,
            GSTAmount = inv.GSTAmount,
            GrandTotal = inv.GrandTotal,
            AmountInWords = inv.AmountInWords,
            PaymentTerms = inv.PaymentTerms,
            CreatedAt = inv.CreatedAt,
            Items = inv.Items.Select(ii => new InvoiceItemDto
            {
                Id = ii.Id,
                DeliveryItemId = ii.DeliveryItemId,
                ItemTypeName = ii.ItemTypeName,
                Description = ii.Description,
                Quantity = ii.Quantity,
                UOM = ii.UOM,
                UnitPrice = ii.UnitPrice,
                LineTotal = ii.LineTotal
            }).ToList(),
            ChallanNumbers = inv.DeliveryChallans.Select(dc => dc.ChallanNumber).ToList()
        };

        public async Task<List<InvoiceDto>> GetByCompanyAsync(int companyId)
        {
            var invoices = await _invoiceRepo.GetByCompanyAsync(companyId);
            return invoices.Select(ToDto).ToList();
        }

        public async Task<PagedResult<InvoiceDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var (items, totalCount) = await _invoiceRepo.GetPagedByCompanyAsync(
                companyId, page, pageSize, search, clientId, dateFrom, dateTo);
            return new PagedResult<InvoiceDto>
            {
                Items = items.Select(ToDto).ToList(),
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize
            };
        }

        public async Task<InvoiceDto?> GetByIdAsync(int id)
        {
            var inv = await _invoiceRepo.GetByIdAsync(id);
            return inv == null ? null : ToDto(inv);
        }

        public async Task<InvoiceDto> CreateAsync(CreateInvoiceDto dto)
        {
            var company = await _companyRepo.GetByIdAsync(dto.CompanyId);
            if (company == null) throw new KeyNotFoundException("Company not found.");

            // Load and validate all challans
            var challans = new List<DeliveryChallan>();
            foreach (var challanId in dto.ChallanIds)
            {
                var dc = await _challanRepo.GetByIdAsync(challanId);
                if (dc == null) throw new KeyNotFoundException($"Challan {challanId} not found.");
                if (dc.Status != "Pending") throw new InvalidOperationException($"Challan {dc.ChallanNumber} is not in Pending status.");
                if (dc.CompanyId != dto.CompanyId) throw new InvalidOperationException($"Challan {dc.ChallanNumber} does not belong to this company.");
                challans.Add(dc);
            }

            // Build invoice items from delivery items + user-provided unit prices
            var invoiceItems = new List<InvoiceItem>();
            foreach (var itemDto in dto.Items)
            {
                // Find the delivery item across all selected challans
                DeliveryItem? deliveryItem = null;
                foreach (var dc in challans)
                {
                    deliveryItem = dc.Items.FirstOrDefault(i => i.Id == itemDto.DeliveryItemId);
                    if (deliveryItem != null) break;
                }
                if (deliveryItem == null)
                    throw new KeyNotFoundException($"Delivery item {itemDto.DeliveryItemId} not found in selected challans.");

                var lineTotal = deliveryItem.Quantity * itemDto.UnitPrice;
                invoiceItems.Add(new InvoiceItem
                {
                    DeliveryItemId = deliveryItem.Id,
                    ItemTypeName = deliveryItem.ItemType?.Name ?? "",
                    Description = deliveryItem.Description,
                    Quantity = deliveryItem.Quantity,
                    UOM = deliveryItem.Unit,
                    UnitPrice = itemDto.UnitPrice,
                    LineTotal = lineTotal
                });
            }

            var subtotal = invoiceItems.Sum(i => i.LineTotal);
            var gstAmount = Math.Round(subtotal * dto.GSTRate / 100, 2);
            var grandTotal = subtotal + gstAmount;

            // Generate next invoice number per company
            if (company.StartingInvoiceNumber == 0)
                throw new InvalidOperationException("Starting invoice number has not been set for this company. Please set it first.");

            int nextInvoiceNumber = company.CurrentInvoiceNumber > 0
                ? company.CurrentInvoiceNumber + 1
                : company.StartingInvoiceNumber;
            company.CurrentInvoiceNumber = nextInvoiceNumber;

            var invoice = new Invoice
            {
                InvoiceNumber = nextInvoiceNumber,
                Date = dto.Date,
                CompanyId = dto.CompanyId,
                ClientId = dto.ClientId,
                Subtotal = subtotal,
                GSTRate = dto.GSTRate,
                GSTAmount = gstAmount,
                GrandTotal = grandTotal,
                AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                PaymentTerms = dto.PaymentTerms,
                Items = invoiceItems
            };

            var created = await _invoiceRepo.CreateAsync(invoice);

            // Transition challans to Invoiced
            foreach (var dc in challans)
            {
                dc.Status = "Invoiced";
                dc.InvoiceId = created.Id;
                await _challanRepo.UpdateAsync(dc);
            }

            // Update company invoice number
            await _companyRepo.UpdateAsync(company);

            // Reload with includes
            var loaded = await _invoiceRepo.GetByIdAsync(created.Id);
            return ToDto(loaded!);
        }

        public async Task<PrintBillDto?> GetPrintBillAsync(int invoiceId)
        {
            var inv = await _invoiceRepo.GetByIdAsync(invoiceId);
            if (inv == null) return null;

            var poNumbers = inv.DeliveryChallans
                .Select(dc => dc.PoNumber)
                .Where(p => !string.IsNullOrEmpty(p))
                .Distinct()
                .ToList();

            return new PrintBillDto
            {
                CompanyBrandName = inv.Company?.BrandName ?? inv.Company?.Name ?? "",
                CompanyLogoPath = inv.Company?.LogoPath,
                CompanyAddress = inv.Company?.FullAddress,
                CompanyPhone = inv.Company?.Phone,
                CompanyNTN = inv.Company?.NTN,
                CompanySTRN = inv.Company?.STRN,
                InvoiceNumber = inv.InvoiceNumber,
                Date = inv.Date,
                ChallanNumbers = inv.DeliveryChallans.Select(dc => dc.ChallanNumber).ToList(),
                ChallanDates = inv.DeliveryChallans.Select(dc => dc.DeliveryDate).ToList(),
                PoNumber = string.Join(", ", poNumbers),
                PoDate = inv.DeliveryChallans.Select(dc => dc.PoDate).FirstOrDefault(),
                ClientName = inv.Client?.Name ?? "",
                ClientAddress = inv.Client?.Address,
                ConcernDepartment = string.Join(", ", inv.DeliveryChallans
                    .Select(dc => dc.Site)
                    .Where(s => !string.IsNullOrEmpty(s))
                    .Distinct()),
                ClientNTN = inv.Client?.NTN,
                ClientSTRN = inv.Client?.STRN,
                Subtotal = inv.Subtotal,
                GSTRate = inv.GSTRate,
                GSTAmount = inv.GSTAmount,
                GrandTotal = inv.GrandTotal,
                AmountInWords = inv.AmountInWords,
                PaymentTerms = inv.PaymentTerms,
                Items = inv.Items.Select((ii, idx) => new PrintBillItemDto
                {
                    SNo = idx + 1,
                    ItemTypeName = ii.ItemTypeName,
                    Description = ii.Description,
                    Quantity = ii.Quantity,
                    UOM = ii.UOM,
                    UnitPrice = ii.UnitPrice,
                    LineTotal = ii.LineTotal
                }).ToList()
            };
        }

        public async Task<PrintTaxInvoiceDto?> GetPrintTaxInvoiceAsync(int invoiceId)
        {
            var inv = await _invoiceRepo.GetByIdAsync(invoiceId);
            if (inv == null) return null;

            var poNumbers = inv.DeliveryChallans
                .Select(dc => dc.PoNumber)
                .Where(p => !string.IsNullOrEmpty(p))
                .Distinct()
                .ToList();

            return new PrintTaxInvoiceDto
            {
                SupplierName = inv.Company?.BrandName ?? inv.Company?.Name ?? "",
                SupplierAddress = inv.Company?.FullAddress,
                SupplierNTN = inv.Company?.NTN,
                SupplierSTRN = inv.Company?.STRN,
                SupplierPhone = inv.Company?.Phone,
                SupplierLogoPath = inv.Company?.LogoPath,
                BuyerName = inv.Client?.Name ?? "",
                BuyerAddress = inv.Client?.Address,
                BuyerPhone = inv.Client?.Phone,
                BuyerNTN = inv.Client?.NTN,
                BuyerSTRN = inv.Client?.STRN,
                InvoiceNumber = inv.InvoiceNumber,
                Date = inv.Date,
                ChallanNumbers = inv.DeliveryChallans.Select(dc => dc.ChallanNumber).ToList(),
                PoNumber = string.Join(", ", poNumbers),
                Subtotal = inv.Subtotal,
                GSTRate = inv.GSTRate,
                GSTAmount = inv.GSTAmount,
                GrandTotal = inv.GrandTotal,
                AmountInWords = inv.AmountInWords,
                // Group items by ItemTypeName for tax invoice (only when ItemTypeName is set)
                Items = inv.Items
                    .GroupBy(ii => string.IsNullOrWhiteSpace(ii.ItemTypeName) ? $"__item_{ii.Id}" : ii.ItemTypeName)
                    .Select(g =>
                    {
                        var totalQty = g.Sum(ii => ii.Quantity);
                        var totalValue = g.Sum(ii => ii.LineTotal);
                        var gstAmt = Math.Round(totalValue * inv.GSTRate / 100, 2);
                        var hasType = !g.Key.StartsWith("__item_");
                        return new PrintTaxItemDto
                        {
                            ItemTypeName = hasType ? g.Key : "",
                            Quantity = totalQty,
                            UOM = g.First().UOM,
                            Description = hasType ? g.Key : g.First().Description,
                            ValueExclTax = totalValue,
                            GSTRate = inv.GSTRate,
                            GSTAmount = gstAmt,
                            TotalInclTax = totalValue + gstAmt
                        };
                    }).ToList()
            };
        }

        public async Task<int> GetTotalCountAsync()
        {
            return await _invoiceRepo.GetTotalCountAsync();
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            return await _invoiceRepo.GetCountByCompanyAsync(companyId);
        }
    }
}
