import { invoiceDocumentTemplate } from "../invoiceDocumentTemplate";

// Shared columns and bindings keep every design consistent with the print DTO.
export const billStarters = [
  { id: "bill-classic-serif", name: "Classic Serif", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#111111", "font": "\"Times New Roman\",Times,serif"}) },
  { id: "bill-modern-minimal", name: "Modern Minimal", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#163b65"}) },
  { id: "bill-corporate-navy", name: "Corporate Navy Band", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#134e4a"}) },
  { id: "bill-bold-banner", name: "Bold Colored Banner", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#263238"}) },
  { id: "bill-monochrome-ink", name: "Monochrome Ink-Saver", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#4a315c"}) },
  { id: "bill-elegant-premium", name: "Elegant Premium", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#3d405b"}) },
  { id: "bill-compact-dense", name: "Compact Dense", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#30475e"}) },
  { id: "bill-left-sidebar", name: "Left Sidebar Strip", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#1f2937"}) },
  { id: "bill-boxed-traditional", name: "Boxed Traditional", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#7a4924"}) },
  { id: "bill-bismillah", name: "Bismillah Header", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#1e3a5f"}) },
  { id: "bill-green-gold", name: "Green & Gold", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#116466"}) },
  { id: "bill-teal-slate", name: "Teal / Slate", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#4a5568"}) },
  { id: "bill-big-letterhead", name: "Big Letterhead", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#224b36"}) },
  { id: "bill-centered-watermark", name: "Centered / Watermark Title", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#334155"}) },
  { id: "bill-govt-form-grid", name: "Government-Form Grid", type: "Bill", description: "Eight-column A4 layout with rounded amounts and a configurable signature", html: invoiceDocumentTemplate("Bill", {"accent": "#111111"}) },
];
