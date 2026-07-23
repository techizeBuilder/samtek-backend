import path from 'path';
import fs from 'fs';

/**
 * Helper function to convert number to words (Indian numbering system)
 */
export const convertNumberToWords = (num) => {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

  if (!num || num === 0) return 'Zero Rupees Only';

  const convertTwoDigit = (n) => {
    if (n < 10) return ones[n];
    if (n >= 10 && n < 20) return teens[n - 10];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  };

  const convertThreeDigit = (n) => {
    if (n < 100) return convertTwoDigit(n);
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertTwoDigit(n % 100) : '');
  };

  const toWords = (n) => {
    if (n < 1000) return convertThreeDigit(n);
    let crores = Math.floor(n / 10000000);
    let lakhs = Math.floor((n % 10000000) / 100000);
    let thousands = Math.floor((n % 100000) / 1000);
    let remainder = n % 1000;
    let result = '';
    if (crores > 0) result += toWords(crores) + ' Crore ';
    if (lakhs > 0) result += toWords(lakhs) + ' Lakh ';
    if (thousands > 0) result += toWords(thousands) + ' Thousand ';
    if (remainder > 0) result += convertThreeDigit(remainder);
    return result.trim();
  };

  const fixed = parseFloat(num).toFixed(2);
  const parts = fixed.split('.');
  const rupees = parseInt(parts[0]);
  const paise = parseInt(parts[1]);
  let result = toWords(rupees) + ' Rupees';
  if (paise > 0) result += ' and ' + toWords(paise) + ' Paise';
  return result + ' Only';
};

/**
 * Dedicated Service Tax Invoice PDF Generator
 * Specific layout for Machine Maintenance & Complaints
 */
export const generateServiceInvoicePDF = async (res, invoiceData) => {
  const PDFDocument = (await import('pdfkit')).default;

  const {
    company = {},
    customer = {},
    machineDetails = {},
    invoiceNo = '',
    date = '',
    ref = '',
    notes = '',
    items = []
  } = invoiceData;

  const L = 30;   // left margin
  const R = 565;  // right edge
  const W = R - L; // total width = 535

  const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNo}.pdf"`);
  doc.pipe(res);

  // ─── COLOURS / FONTS ───────────────────────────────────────────────────────
  const BLACK  = '#000000';
  const DGREY  = '#333333';
  const LGREY  = '#f5f5f5';
  const BORDER = '#cccccc';

  const drawLine = (x1, y1, x2, y2, color = BORDER, w = 0.5) =>
    doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(w).strokeColor(color).stroke();

  const drawRect = (x, y, w, h, fill = null, stroke = BORDER) => {
    doc.rect(x, y, w, h);
    if (fill && stroke) doc.fillAndStroke(fill, stroke);
    else if (fill)   { doc.fillColor(fill).fill(); }
    else              { doc.lineWidth(0.5).strokeColor(stroke).stroke(); }
  };

  // ─── DATA MAPPING ──────────────────────────────────────────────────────────
  const compName  = company.name || company.unitName || company.legalName || 'Company Name';
  const compAddr  = company.address || company.addressLine1 || '';
  const compGST   = company.gst || company.gstin || '';
  const compPhone = company.mobile || company.phone || '';
  const compEmail = company.email || '';

  const custName  = customer.name || 'Unknown Customer';
  const custAddr1 = customer.address || customer.address1 || '';
  const custLoc   = [customer.city, customer.state, customer.pin || customer.pincode].filter(Boolean).join(', ');
  const custGST   = customer.gstin || customer.gst || '';
  const custContact = customer.contactPerson || customer.contact || '';

  // ─── SECTION 1: COMPANY HEADER ─────────────────────────────────────────────
  let y = 30;

  doc.font('Helvetica-Bold').fontSize(15).fillColor(BLACK).text(compName, L, y, { width: 400 });
  y += 20;

  if (compAddr) {
    doc.font('Helvetica').fontSize(8.5).fillColor(DGREY).text(compAddr, L, y, { width: 380 });
    y += 12;
  }
  if (compGST) {
    doc.font('Helvetica').fontSize(8.5).fillColor(BLACK).text(`GST : ${compGST}`, L, y, { width: 380 });
    y += 12;
  }
  if (compPhone) {
    doc.font('Helvetica').fontSize(8.5).fillColor(BLACK).text(`Phone : ${compPhone}`, L, y, { width: 380 });
    y += 12;
  }
  if (compEmail) {
    doc.font('Helvetica').fontSize(8.5).fillColor(BLACK).text(`Email : ${compEmail}`, L, y, { width: 380 });
    y += 12;
  }

  y += 10; 

  // ─── TITLE ─────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(14).fillColor(BLACK).text('Tax Invoice', L, y, { width: W, align: 'center' });
  y += 20;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK).text(`Invoice No. : ${String(invoiceNo)}`, L, y, { width: W, align: 'right' });
  y += 14;
  doc.font('Helvetica-Bold').fontSize(9).text(`Date : ${String(date)}`, L, y, { width: W, align: 'right' });
  y += 14;
  if (ref) {
    doc.font('Helvetica-Bold').fontSize(9).text(`Ref. : ${String(ref)}`, L, y, { width: W, align: 'right' });
    y += 14;
  }

  y += 6;
  drawLine(L, y, R, y, BORDER, 0.8);
  y += 8;

  // ─── SECTION 2: BILLING & SERVICE DETAILS ──────────────────────────────────
  const halfW = W / 2;

  let leftLines = 1;
  if (custContact) leftLines++;
  if (custAddr1) leftLines += 2;
  if (custLoc) leftLines++;
  if (custGST) leftLines++;
  
  const rightLines = 6; 
  const maxLines = Math.max(leftLines, rightLines);
  const addrBoxH = Math.max(90, 14 + maxLines * 13.5);

  drawRect(L, y, W, addrBoxH, null, BORDER);
  drawLine(L + halfW, y, L + halfW, y + addrBoxH, BORDER);

  drawRect(L, y, halfW, 14, LGREY, BORDER);
  drawRect(L + halfW, y, halfW, 14, LGREY, BORDER);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK);
  doc.text('Billing Address', L + 5, y + 3, { width: halfW - 10 });
  
  // DEDICATED HEADER FOR SERVICE INVOICE
  doc.text('Machine & Service Details', L + halfW + 5, y + 3, { width: halfW - 10 });

  let leftAy = y + 18;
  let rightAy = y + 18;

  // --- LEFT COLUMN: Customer Info ---
  if (custContact) {
    doc.font('Helvetica').fontSize(8).fillColor(DGREY).text(custContact, L + 5, leftAy, { width: halfW - 10 });
    leftAy += 12;
  }
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK).text(custName, L + 5, leftAy, { width: halfW - 10 });
  leftAy += 13;
  
  doc.font('Helvetica').fontSize(8).fillColor(BLACK);
  if (custAddr1) {
    doc.text(custAddr1, L + 5, leftAy, { width: halfW - 10 });
    leftAy += 12;
  }
  if (custLoc) {
    doc.text(custLoc, L + 5, leftAy, { width: halfW - 10 });
    leftAy += 12;
  }
  if (custGST) {
    doc.font('Helvetica-Bold').text(`GSTIN : ${custGST}`, L + 5, leftAy, { width: halfW - 10 });
    leftAy += 14;
  }

  // --- RIGHT COLUMN: Machine Info ---
  doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text(`Machine Type:`, L + halfW + 5, rightAy, { continued: true }).font('Helvetica').text(` ${machineDetails.machineType || 'N/A'}`);
  rightAy += 13;
  doc.font('Helvetica-Bold').text(`Model:`, L + halfW + 5, rightAy, { continued: true }).font('Helvetica').text(` ${machineDetails.model || 'N/A'}`);
  rightAy += 13;
  doc.font('Helvetica-Bold').text(`Serial No:`, L + halfW + 5, rightAy, { continued: true }).font('Helvetica').text(` ${machineDetails.serialNumber || 'N/A'}`);
  rightAy += 13;
  
  // Warranty & AMC
  doc.font('Helvetica-Bold').text(`Warranty:`, L + halfW + 5, rightAy, { continued: true }).font('Helvetica').text(` ${machineDetails.warrantyStatus || 'Unknown'}`);
  rightAy += 13;
  doc.font('Helvetica-Bold').text(`AMC:`, L + halfW + 5, rightAy, { continued: true }).font('Helvetica').text(` ${machineDetails.amcStatus || 'Unknown'}`);
  rightAy += 13;
  
  doc.font('Helvetica-Bold').text(`Reported Issue:`, L + halfW + 5, rightAy, { continued: true }).font('Helvetica').text(` ${machineDetails.issue || 'N/A'}`);
  rightAy += 13;

  y += addrBoxH + 6;

  // ─── SECTION 3: ITEMS TABLE ─────────────────────────────────────────────────
  // 🔥 UPDATED: Replaced MRP with "GST Amount", slightly adjusted widths for larger numbers
  const cols = [
    { label: 'No.',                key: 'no',       w: 20,  align: 'center' },
    { label: 'Item & Description', key: 'desc',     w: 170, align: 'left'   },
    { label: 'HSN/SAC',            key: 'hsn',      w: 45,  align: 'center' },
    { label: 'Qty',                key: 'qty',      w: 25,  align: 'right'  },
    { label: 'Unit',               key: 'unit',     w: 35,  align: 'center' },
    { label: 'Rate (Rs.)',         key: 'rate',     w: 40,  align: 'right'  },
    { label: 'Less:\nDiscount\n(Rs.)', key: 'lessDisc', w: 40, align: 'right' },
    { label: 'Discount',           key: 'disc',     w: 30,  align: 'right'  },
    { label: 'Taxable (Rs.)',      key: 'taxable',  w: 45,  align: 'right'  },
    { label: 'GST (Rs.)',          key: 'gstAmt',   w: 40,  align: 'right'  }, // <--- REPLACED MRP
    { label: 'Amount (Rs.)',       key: 'amount',   w: 45,  align: 'right'  },
  ];

  let cx = L;
  cols.forEach(c => { c.x = cx; cx += c.w; });

  const tblHeaderH = 34;
  const rowH       = 22; 

  drawRect(L, y, W, tblHeaderH, LGREY, BORDER);

  let vx = L;
  cols.forEach((c, i) => {
    if (i > 0) drawLine(vx, y, vx, y + tblHeaderH, BORDER);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(BLACK)
       .text(c.label, c.x + 2, y + 4, { width: c.w - 4, align: c.align, lineGap: 1 });
    vx += c.w;
  });
  drawLine(L, y, R, y, BORDER);
  drawLine(L, y + tblHeaderH, R, y + tblHeaderH, BORDER);

  y += tblHeaderH;

  // ─── ROWS ──────────────────────────────────────────────────────────────────
  let grandSubtotal = 0;
  let grandDiscount = 0;
  let grandTaxable  = 0;
  let grandGstTotal = 0; 
  let grandAmount   = 0;

  items.forEach((item, idx) => {
    const qty      = parseFloat(item.quantity || item.qty || item.qtyIssued || 0);
    const rate     = parseFloat(item.rate || item.unitPrice || item.salePrice || 0);
    const discPct  = parseFloat(item.discountPct || item.discount || 0);
    const hsn      = item.hsn || '';
    const unit     = item.unit || 'nos';
    
    // PULL GST PERCENTAGE FROM ITEM
    const gstPct   = parseFloat(item.gst || 0); 
    const name     = `${item.productName || item.name || ''} (GST: ${gstPct}%)`;

    // 1. Calculate Discount & Taxable Base
    const lessDisc = parseFloat(((rate * qty) - (rate * qty * (1 - discPct / 100))).toFixed(2));
    const taxable  = parseFloat((rate * qty * (1 - discPct / 100)).toFixed(2));
    
    // 2. Calculate GST Amount
    const gstAmount = taxable * (gstPct / 100);
    const amount    = taxable + gstAmount; 

    // Add to Running Totals
    grandSubtotal += rate * qty;
    grandDiscount += lessDisc;
    grandTaxable  += taxable;
    grandGstTotal += gstAmount;
    grandAmount   += amount;

    if (idx % 2 === 0) drawRect(L, y, W, rowH, '#ffffff', BORDER);
    else               drawRect(L, y, W, rowH, LGREY, BORDER);

    // Build the row mapping
    const row = {
      no:       String(idx + 1),
      desc:     name,
      hsn:      hsn,
      qty:      qty % 1 === 0 ? String(qty) : qty.toFixed(2),
      unit:     unit,
      rate:     rate.toFixed(2),
      lessDisc: lessDisc > 0 ? lessDisc.toFixed(2) : '—',
      disc:     discPct > 0 ? `${discPct.toFixed(2)}%` : '—',
      taxable:  taxable.toFixed(2),
      gstAmt:   gstAmount.toFixed(2), // <--- MAP GST AMOUNT HERE
      amount:   amount.toFixed(2),
    };

    let rvx = L;
    cols.forEach((c, i) => {
      if (i > 0) drawLine(rvx, y, rvx, y + rowH, BORDER);
      doc.font('Helvetica').fontSize(7.5).fillColor(BLACK)
         .text(row[c.key], c.x + 3, y + 6, { width: c.w - 6, align: c.align, ellipsis: true });
      rvx += c.w;
    });

    drawLine(L, y + rowH, R, y + rowH, BORDER);
    y += rowH;

    if (y > 750) {
      doc.addPage();
      y = 30;
    }
  });

  // ─── TOTALS ROW ─────────────────────────────────────────────────────────────
  const totRowH = 18;
  drawRect(L, y, W, totRowH, LGREY, BORDER);
  let rvx2 = L;
  const totals = {
    no: '', desc: 'Total', hsn: '', qty: '', unit: '',
    rate: '',
    lessDisc: grandDiscount > 0 ? grandDiscount.toFixed(2) : '—',
    disc: '',
    taxable: grandTaxable.toFixed(2),
    gstAmt: grandGstTotal.toFixed(2), // <--- TOTAL GST MAP
    amount: grandAmount.toFixed(2),
  };
  cols.forEach((c, i) => {
    if (i > 0) drawLine(rvx2, y, rvx2, y + totRowH, BORDER);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BLACK)
       .text(totals[c.key], c.x + 2, y + 5, { width: c.w - 4, align: c.align });
    rvx2 += c.w;
  });
  drawLine(L, y + totRowH, R, y + totRowH, BORDER);
  y += totRowH + 5;

  // ─── SECTION 4: AMOUNT IN WORDS + GRAND TOTAL ──────────────────────────────
  const footerH = 38;
  drawRect(L, y, W, footerH, null, BORDER);
  drawLine(L + W * 0.53, y, L + W * 0.53, y + footerH, BORDER);

  const roundOff = parseFloat((Math.round(grandAmount) - grandAmount).toFixed(2));
  const grandTotal = Math.round(grandAmount);

  doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
     .text('Total Invoice Amount in Words :', L + 5, y + 5);
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(convertNumberToWords(grandTotal), L + 5, y + 17, { width: W * 0.53 - 10 });

  const rtX = L + W * 0.53 + 5;
  const rtW = W * 0.47 - 10;
  doc.font('Helvetica').fontSize(8.5).fillColor(BLACK)
     .text('Round Off (Rs.)', rtX, y + 5, { width: rtW - 50, align: 'left', continued: false });
  doc.font('Helvetica-Bold').fontSize(8.5)
     .text(roundOff.toFixed(2), rtX + rtW - 50, y + 5, { width: 50, align: 'right' });

  drawLine(L + W * 0.53, y + 20, R, y + 20, BORDER);

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text('Grand Total (Rs.)', rtX, y + 23, { width: rtW - 60, align: 'left' });
  doc.fontSize(9)
     .text(grandTotal.toFixed(2), rtX + rtW - 60, y + 23, { width: 60, align: 'right' });

  y += footerH + 5;

  // ─── NOTES ──────────────────────────────────────────────────────────────────
  if (notes) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
       .text('Notes : ', L, y, { continued: true });
    doc.font('Helvetica').text(notes);
    y += 14;
  }

  // ─── SECTION 5: FOOTER ──────────────────────────────────────────────────────
  y += 5;
  const sigBoxH = 60;
  drawRect(L, y, W, sigBoxH, null, BORDER);
  drawLine(L + W * 0.55, y, L + W * 0.55, y + sigBoxH, BORDER);

  doc.font('Helvetica').fontSize(7.5).fillColor(DGREY)
     .text('This is a computer-generated service invoice. E. & O. E.', L + 5, y + sigBoxH - 12, { width: W * 0.55 - 10 });

  doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
     .text(`For, ${company.name || ''}`, L + W * 0.55 + 5, y + 8, { width: W * 0.45 - 10, align: 'center' });

  // Company stamp — the one uploaded by the Company Admin (Company.stampUrl,
  // e.g. /uploads/company-stamps/stamp_x.png), never a generic placeholder.
  // Drawn between the "For, <company>" line and "Authorised Signatory" only
  // if that company has actually uploaded one.
  if (company.stampUrl) {
    try {
      const stampPath = path.join(process.cwd(), company.stampUrl);
      if (fs.existsSync(stampPath)) {
        const stampW = 36;
        const stampX = L + W * 0.55 + (W * 0.45 - stampW) / 2;
        doc.image(stampPath, stampX, y + 16, { width: stampW, height: stampW });
      }
    } catch (e) {
      console.error('Could not add company stamp to service invoice:', e.message);
    }
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
     .text('Authorised Signatory', L + W * 0.55 + 5, y + sigBoxH - 14, { width: W * 0.45 - 10, align: 'center' });

  doc.end();
};