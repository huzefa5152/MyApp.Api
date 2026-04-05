const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDec = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd = String(dt.getDate()).padStart(2, "0");
  const mmm = months[dt.getMonth()];
  const yy = String(dt.getFullYear()).slice(-2);
  return `${dd}-${mmm}-${yy}`;
};

export function buildBillPrintHtml(d) {
  const MIN_ROWS = 18;

  // Build item rows
  let itemRows = d.items.map(i =>
    `<tr>
      <td class="cell c">${i.sNo}</td>
      <td class="cell c">${i.quantity}</td>
      <td class="cell">${i.description}</td>
      <td class="cell r">Rs${fmt(i.unitPrice)}</td>
      <td class="cell r">Rs &nbsp; ${fmt(i.lineTotal)}</td>
    </tr>`
  ).join("");

  // Pad with empty rows
  const emptyCount = Math.max(0, MIN_ROWS - d.items.length);
  for (let i = 0; i < emptyCount; i++) {
    itemRows += `<tr><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell r">Rs &nbsp; -</td></tr>`;
  }

  const dcNos = d.challanNumbers?.join(", ") || "";
  const dcDates = d.challanDates?.map(dt => fmtDate(dt)).filter(Boolean).join(", ") || "";

  // Collect unique item type names for the footer
  const typeNames = [...new Set(d.items.map(i => i.itemTypeName).filter(Boolean))];
  const typesLine = typeNames.length > 0 ? typeNames.join(" | ") + " |" : "";

  return `<!DOCTYPE html><html><head><title>Bill #${d.invoiceNumber}</title>
<style>
  @media print {
    @page { size: A4; margin: 0; }
    html, body { height: 100%; margin: 0; }
    .footer-section { page-break-inside: avoid; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
  }
  html, body { height: 100%; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12px; color: #000;
         padding: 10mm 14mm; }

  /* ---- Header ---- */
  .top-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0; }
  .top-left { display: flex; align-items: center; gap: 10px; }
  .top-left img { height: 50px; }
  .company-name { font-size: 28px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; font-style: italic; }
  .top-right { text-align: right; }
  .bill-title { font-size: 24px; font-weight: 900; text-decoration: underline; text-transform: uppercase; }
  .company-address { font-size: 10px; font-weight: 700; font-style: italic; color: #000; margin-top: 1px; line-height: 1.3; }
  .company-contact { font-size: 10px; margin-top: 4px; line-height: 1.3; }

  /* ---- Info Section ---- */
  .info-section { display: flex; justify-content: space-between; margin-top: 6px; }
  .info-left { flex: 1; }
  .info-right { text-align: right; }
  .info-line { font-size: 11.5px; margin-bottom: 3px; }
  .info-line strong { font-weight: 700; }
  .info-line .val { font-weight: 700; font-size: 12px; }

  /* Date box */
  .date-box { display: inline-flex; border: 1.5px solid #000; font-size: 11px; margin-bottom: 4px; }
  .date-box .lbl { padding: 3px 8px; font-weight: 600; border-right: 1.5px solid #000; }
  .date-box .val { padding: 3px 8px; font-weight: 700; }

  .bill-num { font-size: 14px; font-weight: 900; margin-bottom: 4px; }
  .dc-info { font-size: 11px; margin-bottom: 2px; }
  .dc-info strong { font-weight: 700; }

  .to-line { font-size: 11.5px; margin-top: 8px; margin-bottom: 2px; }
  .client-name { font-size: 13px; font-weight: 900; margin-bottom: 4px; }
  .ntn-line { font-size: 10.5px; margin-bottom: 3px; }

  .po-section { margin-top: 4px; margin-bottom: 6px; }
  .po-line { font-size: 12px; font-weight: 700; }
  .po-line span { font-weight: 400; margin-left: 10px; font-size: 13px; font-weight: 700; }

  /* ---- Table ---- */
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background-color: #2c3e50 !important; color: #fff !important; font-weight: 700; font-size: 10px; text-transform: uppercase; padding: 6px 8px; border: 1px solid #2c3e50; font-style: italic; }
  .cell { border: 1px solid #888; padding: 4px 8px; font-size: 11px; height: 22px; }
  .c { text-align: center; }
  .r { text-align: right; }
  tbody tr:nth-child(odd) td { background-color: #ffffff !important; }
  tbody tr:nth-child(even) td { background-color: #d6e4f0 !important; }

  /* ---- Totals ---- */
  .totals-section { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 8px; }
  .words-section { flex: 1; }
  .words-label { font-size: 11px; font-weight: 700; font-style: italic; color: #c00; }
  .words-text { font-size: 13px; font-weight: 700; font-style: italic; margin-top: 6px; }
  .totals-box { min-width: 240px; }
  .total-row { display: flex; justify-content: space-between; font-size: 11.5px; padding: 3px 0; border-bottom: 1px solid #ccc; }
  .total-row.grand { font-weight: 900; font-size: 12.5px; border-bottom: 2px solid #000; border-top: 2px solid #000; }
  .total-row .lbl { font-weight: 700; text-transform: uppercase; font-style: italic; }

  /* ---- Footer ---- */
  .sig-row { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 20px; }
  .sig-block { text-align: center; }
  .sig-block .line { width: 180px; border-top: 1px solid #000; margin-bottom: 4px; }
  .sig-block .label { font-size: 10px; font-weight: 600; }
  .types-footer { text-align: center; margin-top: 20px; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
</style></head><body>

<!-- Header -->
<div class="top-row">
  <div class="top-left">
    ${d.companyLogoPath ? `<img src="${d.companyLogoPath}" />` : ""}
    <span class="company-name">${d.companyBrandName}</span>
  </div>
  <div class="top-right">
    <div class="bill-title">BILL</div>
  </div>
</div>

<!-- Info Section -->
<div class="info-section">
  <div class="info-left">
    ${d.companyAddress ? `<div class="company-address">${d.companyAddress}</div>` : ""}
    ${d.companyPhone ? `<div class="company-contact">${d.companyPhone}</div>` : ""}
  </div>
  <div class="info-right">
    <div class="date-box"><span class="lbl">Date:</span><span class="val">${fmtDate(d.date)}</span></div>
    <div class="bill-num">BILL # ${d.invoiceNumber}</div>
  </div>
</div>

<div class="info-section" style="margin-top:2px">
  <div class="info-left"></div>
  <div class="info-right">
    <div class="dc-info"><strong>DC #</strong> ${d.challanNumbers?.join(", ") || ""}</div>
    ${dcDates ? `<div class="dc-info"><strong>D.C Date</strong> ${dcDates}</div>` : ""}
  </div>
</div>

<div class="to-line"><strong>To;</strong></div>
<div class="info-section" style="margin-top:0">
  <div class="info-left">
    <div class="client-name">${d.clientName}</div>
  </div>
  <div class="info-right">
    ${d.clientNTN ? `<div class="ntn-line"><strong>NTN #</strong> ${d.clientNTN}</div>` : ""}
    ${d.clientSTRN ? `<div class="ntn-line"><strong>GST #</strong> ${d.clientSTRN}</div>` : ""}
  </div>
</div>

<div class="po-section">
  <div class="po-line">Purchase Order <span>${d.poNumber || "\u2014"}</span></div>
  ${d.poDate ? `<div class="po-line">P.O Date <span>${fmtDate(d.poDate)}</span></div>` : ""}
</div>

<!-- Items Table -->
<table>
  <thead><tr>
    <th style="width:30px">S #</th>
    <th style="width:55px">Quantity</th>
    <th>Item Details</th>
    <th style="width:85px">Unit Price</th>
    <th style="width:90px">Total Price</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<!-- Totals & Amount in Words -->
<div class="footer-section">
  <div class="totals-section">
    <div class="words-section">
      <div class="words-label">Amount In Words:</div>
      <div class="words-text">${d.amountInWords}</div>
    </div>
    <div class="totals-box">
      <div class="total-row"><span class="lbl">SUB TOTAL</span><span>Rs${fmt(d.subtotal)}</span></div>
      <div class="total-row"><span class="lbl">GST (${d.gstRate}%)</span><span>Rs${fmt(d.gstAmount)}</span></div>
      <div class="total-row grand"><span class="lbl">GRAND TOTAL</span><span>Rs${fmt(d.grandTotal)}</span></div>
    </div>
  </div>

  <!-- Signatures -->
  <div class="sig-row">
    <div class="sig-block"><div class="line"></div><div class="label">Signature and Stamp</div></div>
    <div class="sig-block"><div class="line"></div><div class="label">Receiver Signature and Stamp</div></div>
  </div>

  <!-- Item Types Footer -->
  ${typesLine ? `<div class="types-footer">${typesLine}</div>` : ""}
</div>

</body></html>`;
}

export function buildTaxInvoicePrintHtml(d) {
  const MIN_ROWS = 15;

  // Group items by ItemTypeName
  const groups = {};
  d.items.forEach(i => {
    const type = i.itemTypeName || "Other";
    if (!groups[type]) groups[type] = [];
    groups[type].push(i);
  });

  let sNo = 0;
  let totalItemRows = 0;
  let itemRows = "";
  const typeNames = Object.keys(groups);

  typeNames.forEach((typeName) => {
    // Type header row
    itemRows += `<tr><td colspan="8" style="background:#e8e8e8;font-weight:700;font-size:10.5px;padding:4px 6px">${typeName}</td></tr>`;
    totalItemRows++;
    groups[typeName].forEach(i => {
      sNo++;
      totalItemRows++;
      itemRows += `<tr>
        <td class="cell c">${sNo}</td>
        <td class="cell c">${i.quantity}</td>
        <td class="cell c">${i.uom}</td>
        <td class="cell">${i.description}</td>
        <td class="cell r">${fmtDec(i.valueExclTax)}</td>
        <td class="cell c">${i.gstRate}%</td>
        <td class="cell r">${fmtDec(i.gstAmount)}</td>
        <td class="cell r">${fmtDec(i.totalInclTax)}</td>
      </tr>`;
    });
  });

  // Pad with empty rows
  const emptyCount = Math.max(0, MIN_ROWS - totalItemRows);
  for (let i = 0; i < emptyCount; i++) {
    itemRows += `<tr><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td><td class="cell">&nbsp;</td></tr>`;
  }

  const dcNos = d.challanNumbers?.join(", ") || "";

  return `<!DOCTYPE html><html><head><title>Tax Invoice #${d.invoiceNumber}</title>
<style>
  @media print { @page { size: A4; margin: 0; } html, body { height: 100%; margin: 0; } .footer-section { page-break-inside: avoid; } }
  * { box-sizing: border-box; margin: 0; padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
  }
  html, body { height: 100%; }
  body { font-family: "Times New Roman", Times, serif; font-size: 11px; color: #000; padding: 10mm 12mm; }
  .title { text-align: center; font-size: 18px; font-weight: 800; text-decoration: underline; margin-bottom: 12px; text-transform: uppercase; }
  .parties { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 10px; }
  .party { flex: 1; border: 1px solid #000; padding: 8px; font-size: 10.5px; }
  .party h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 3px; }
  .party p { margin: 2px 0; }
  .meta { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background-color: #2c3e50 !important; color: #fff !important; font-weight: 700; font-size: 9px; text-transform: uppercase; padding: 5px; border: 1px solid #2c3e50; }
  .cell { border: 1px solid #888; padding: 4px 5px; font-size: 10px; height: 22px; }
  .c { text-align: center; }
  .r { text-align: right; }
  tbody tr:nth-child(odd) td { background-color: #ffffff !important; }
  tbody tr:nth-child(even) td { background-color: #d6e4f0 !important; }
  .totals td { font-weight: 600; font-size: 10.5px; }
  .words { margin-top: 6px; font-size: 10.5px; font-style: italic; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 20px; }
  .sig-block { text-align: center; }
  .sig-block .line { width: 180px; border-top: 1px solid #000; margin-bottom: 4px; }
  .sig-block .label { font-size: 10px; font-weight: 600; }
</style></head><body>
<div class="title">SALES TAX INVOICE</div>
<div class="parties">
  <div class="party">
    <h4>Supplier</h4>
    <p><strong>${d.supplierName}</strong></p>
    ${d.supplierAddress ? `<p>${d.supplierAddress}</p>` : ""}
    ${d.supplierPhone ? `<p>Ph: ${d.supplierPhone}</p>` : ""}
    ${d.supplierNTN ? `<p>NTN: ${d.supplierNTN}</p>` : ""}
    ${d.supplierSTRN ? `<p>STRN: ${d.supplierSTRN}</p>` : ""}
  </div>
  <div class="party">
    <h4>Buyer</h4>
    <p><strong>${d.buyerName}</strong></p>
    ${d.buyerAddress ? `<p>${d.buyerAddress}</p>` : ""}
    ${d.buyerNTN ? `<p>NTN: ${d.buyerNTN}</p>` : ""}
    ${d.buyerSTRN ? `<p>STRN: ${d.buyerSTRN}</p>` : ""}
  </div>
</div>
<div class="meta">
  <div><strong>Invoice No:</strong> ${d.invoiceNumber}</div>
  <div><strong>Date:</strong> ${fmtDate(d.date)}</div>
  <div><strong>D.C. No:</strong> ${dcNos}</div>
  ${d.poNumber ? `<div><strong>P.O. No:</strong> ${d.poNumber}</div>` : ""}
</div>
<table>
  <thead><tr>
    <th style="width:28px">S#</th>
    <th style="width:40px">Qty</th>
    <th style="width:40px">UOM</th>
    <th>Description</th>
    <th style="width:80px">Value Excl. Tax</th>
    <th style="width:45px">GST %</th>
    <th style="width:70px">GST Amount</th>
    <th style="width:85px">Total Incl. Tax</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
  <tfoot class="totals">
    <tr>
      <td colspan="4" class="r">Subtotal (Excl. Tax)</td>
      <td class="r">${fmtDec(d.subtotal)}</td>
      <td></td>
      <td class="r">${fmtDec(d.gstAmount)}</td>
      <td class="r">${fmtDec(d.grandTotal)}</td>
    </tr>
  </tfoot>
</table>
<div class="footer-section">
  <div class="words"><strong>Amount in Words:</strong> ${d.amountInWords}</div>
  <div class="sig-row">
    <div class="sig-block"><div class="line"></div><div class="label">Signature and Stamp</div></div>
    <div class="sig-block"><div class="line"></div><div class="label">Receiver Signature and Stamp</div></div>
  </div>
</div>
</body></html>`;
}
