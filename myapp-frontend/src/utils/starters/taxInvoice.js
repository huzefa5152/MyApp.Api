import { invoiceDocumentTemplate } from "../invoiceDocumentTemplate";

// Shared columns and bindings keep every design consistent with the print DTO.
export const taxInvoiceStarters = [
  { id: "taxinvoice-classic-serif", name: "Classic Serif", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#111111", "font": "\"Times New Roman\",Times,serif"}) },
  { id: "taxinvoice-modern-minimal", name: "Modern Minimal", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#163b65"}) },
  { id: "taxinvoice-corporate-navy", name: "Corporate Navy Band", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#134e4a"}) },
  { id: "taxinvoice-bold-banner", name: "Bold Colored Banner", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#263238"}) },
  { id: "taxinvoice-monochrome-ink", name: "Monochrome Ink-Saver", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#4a315c"}) },
  { id: "taxinvoice-elegant-premium", name: "Elegant Premium", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#3d405b"}) },
  { id: "taxinvoice-compact-dense", name: "Compact Dense", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#30475e"}) },
  { id: "taxinvoice-left-sidebar", name: "Left Sidebar Strip", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#1f2937"}) },
  { id: "taxinvoice-boxed-traditional", name: "Boxed Traditional", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#7a4924"}) },
  { id: "taxinvoice-bismillah", name: "Bismillah Header", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#1e3a5f"}) },
  { id: "taxinvoice-green-gold", name: "Green & Gold", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#116466"}) },
  { id: "taxinvoice-teal-slate", name: "Teal / Slate", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#4a5568"}) },
  { id: "taxinvoice-big-letterhead", name: "Big Letterhead", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#224b36"}) },
  { id: "taxinvoice-centered-watermark", name: "Centered / Watermark Title", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#334155"}) },
  { id: "taxinvoice-government-grid", name: "Government-Form Grid", type: "TaxInvoice", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("TaxInvoice", {"accent": "#111111"}) },
];
