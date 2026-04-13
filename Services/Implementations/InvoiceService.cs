using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
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
        private readonly AppDbContext _context;

        public InvoiceService(
            IInvoiceRepository invoiceRepo,
            IDeliveryChallanRepository challanRepo,
            ICompanyRepository companyRepo,
            IClientRepository clientRepo,
            AppDbContext context)
        {
            _invoiceRepo = invoiceRepo;
            _challanRepo = challanRepo;
            _companyRepo = companyRepo;
            _clientRepo = clientRepo;
            _context = context;
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
            DocumentType = inv.DocumentType,
            PaymentMode = inv.PaymentMode,
            FbrInvoiceNumber = inv.FbrInvoiceNumber,
            FbrIRN = inv.FbrIRN,
            FbrStatus = inv.FbrStatus,
            FbrSubmittedAt = inv.FbrSubmittedAt,
            FbrErrorMessage = inv.FbrErrorMessage,
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
                LineTotal = ii.LineTotal,
                HSCode = ii.HSCode,
                FbrUOMId = ii.FbrUOMId,
                SaleType = ii.SaleType,
                RateId = ii.RateId
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

                var description = !string.IsNullOrWhiteSpace(itemDto.Description)
                    ? itemDto.Description
                    : deliveryItem.Description;
                var lineTotal = deliveryItem.Quantity * itemDto.UnitPrice;
                invoiceItems.Add(new InvoiceItem
                {
                    DeliveryItemId = deliveryItem.Id,
                    ItemTypeName = deliveryItem.ItemType?.Name ?? "",
                    Description = description,
                    Quantity = deliveryItem.Quantity,
                    UOM = deliveryItem.Unit,
                    UnitPrice = itemDto.UnitPrice,
                    LineTotal = lineTotal,
                    HSCode = itemDto.HSCode,
                    FbrUOMId = itemDto.FbrUOMId,
                    SaleType = itemDto.SaleType,
                    RateId = itemDto.RateId
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
                DocumentType = dto.DocumentType,
                PaymentMode = dto.PaymentMode,
                FbrInvoiceNumber = string.IsNullOrEmpty(company.InvoiceNumberPrefix)
                    ? nextInvoiceNumber.ToString()
                    : $"{company.InvoiceNumberPrefix}{nextInvoiceNumber}",
                Items = invoiceItems
            };

            // Wrap invoice creation + challan transitions + company update in a single transaction
            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                var created = await _invoiceRepo.CreateAsync(invoice);

                // Transition challans to Invoiced + apply any PO date updates
                foreach (var dc in challans)
                {
                    if (dto.PoDateUpdates.TryGetValue(dc.Id, out var poDate))
                        dc.PoDate = poDate;
                    dc.Status = "Invoiced";
                    dc.InvoiceId = created.Id;
                    await _challanRepo.UpdateAsync(dc);
                }

                // Update company invoice number
                await _companyRepo.UpdateAsync(company);

                // Auto-save new item descriptions for future use
                var newDescs = dto.Items
                    .Where(i => !string.IsNullOrWhiteSpace(i.Description))
                    .Select(i => i.Description!)
                    .Distinct()
                    .ToList();
                if (newDescs.Any())
                {
                    var existing = await _context.ItemDescriptions
                        .Where(d => newDescs.Contains(d.Name))
                        .Select(d => d.Name)
                        .ToListAsync();
                    foreach (var desc in newDescs.Where(d => !existing.Contains(d)))
                    {
                        _context.ItemDescriptions.Add(new ItemDescription { Name = desc });
                    }
                    await _context.SaveChangesAsync();
                }

                await transaction.CommitAsync();

                // Reload with includes
                var loaded = await _invoiceRepo.GetByIdAsync(created.Id);
                return ToDto(loaded!);
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var invoice = await _invoiceRepo.GetByIdAsync(id);
            if (invoice == null) return false;

            // Cannot delete FBR-submitted invoices
            if (invoice.FbrStatus == "Submitted")
                throw new InvalidOperationException("Cannot delete an invoice that has been submitted to FBR.");

            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // Revert linked challans from "Invoiced" → "Pending"
                foreach (var dc in invoice.DeliveryChallans)
                {
                    var hasPo = !string.IsNullOrWhiteSpace(dc.PoNumber);
                    dc.Status = hasPo ? "Pending" : "No PO";
                    dc.InvoiceId = null;
                    await _challanRepo.UpdateAsync(dc);
                }

                // Delete invoice items then invoice
                await _context.InvoiceItems.Where(ii => ii.InvoiceId == id).ExecuteDeleteAsync();
                await _context.Invoices.Where(i => i.Id == id).ExecuteDeleteAsync();

                await transaction.CommitAsync();
                return true;
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
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
                FbrIRN = inv.FbrIRN,
                FbrStatus = inv.FbrStatus,
                FbrSubmittedAt = inv.FbrSubmittedAt,
                // Group items by ItemTypeName only if ALL items have an item type; otherwise list individually
                Items = inv.Items.All(ii => !string.IsNullOrWhiteSpace(ii.ItemTypeName))
                    ? inv.Items
                        .GroupBy(ii => ii.ItemTypeName)
                        .Select(g =>
                        {
                            var totalQty = g.Sum(ii => ii.Quantity);
                            var totalValue = g.Sum(ii => ii.LineTotal);
                            var gstAmt = Math.Round(totalValue * inv.GSTRate / 100, 2);
                            return new PrintTaxItemDto
                            {
                                ItemTypeName = g.Key,
                                Quantity = totalQty,
                                UOM = g.First().UOM,
                                Description = g.Key,
                                ValueExclTax = totalValue,
                                GSTRate = inv.GSTRate,
                                GSTAmount = gstAmt,
                                TotalInclTax = totalValue + gstAmt
                            };
                        }).ToList()
                    : inv.Items.Select(ii =>
                        {
                            var gstAmt = Math.Round(ii.LineTotal * inv.GSTRate / 100, 2);
                            return new PrintTaxItemDto
                            {
                                ItemTypeName = ii.ItemTypeName,
                                Quantity = ii.Quantity,
                                UOM = ii.UOM,
                                Description = ii.Description,
                                ValueExclTax = ii.LineTotal,
                                GSTRate = inv.GSTRate,
                                GSTAmount = gstAmt,
                                TotalInclTax = ii.LineTotal + gstAmt
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
