"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined)
        k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o)
                if (Object.prototype.hasOwnProperty.call(o, k))
                    ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule)
            return mod;
        var result = {};
        if (mod != null)
            for (var k = ownKeys(mod), i = 0; i < k.length; i++)
                if (k[i] !== "default")
                    __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateStandardizedInvoicePDF = exports.convertNumberToWords = void 0;
/**
 * Helper function to convert number to words (Indian numbering system)
 */
const convertNumberToWords = (num) => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    if (!num || num === 0)
        return 'Zero Rupees Only';
    const convertTwoDigit = (n) => {
        if (n < 10)
            return ones[n];
        if (n >= 10 && n < 20)
            return teens[n - 10];
        return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    };
    const convertThreeDigit = (n) => {
        if (n < 100)
            return convertTwoDigit(n);
        return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertTwoDigit(n % 100) : '');
    };
    const toWords = (n) => {
        if (n < 1000)
            return convertThreeDigit(n);
        let crores = Math.floor(n / 10000000);
        let lakhs = Math.floor((n % 10000000) / 100000);
        let thousands = Math.floor((n % 100000) / 1000);
        let remainder = n % 1000;
        let result = '';
        if (crores > 0)
            result += toWords(crores) + ' Crore ';
        if (lakhs > 0)
            result += toWords(lakhs) + ' Lakh ';
        if (thousands > 0)
            result += toWords(thousands) + ' Thousand ';
        if (remainder > 0)
            result += convertThreeDigit(remainder);
        return result.trim();
    };
    const fixed = parseFloat(num).toFixed(2);
    const parts = fixed.split('.');
    const rupees = parseInt(parts[0]);
    const paise = parseInt(parts[1]);
    let result = toWords(rupees) + ' Rupees';
    if (paise > 0)
        result += ' and ' + toWords(paise) + ' Paise';
    return result + ' Only';
};
exports.convertNumberToWords = convertNumberToWords;
/**
 * Standardized Tax Invoice PDF Generator
 * Matches the layout with:
 * - Company info top-left
 * - "Tax Invoice" title centered
 * - Invoice No / Date / Ref on top-right
 * - Billing Address | Shipping Address table
 */
const generateStandardizedInvoicePDF = (res, invoiceData) => __awaiter(void 0, void 0, void 0, function* () {
    const PDFDocument = (yield Promise.resolve().then(() => __importStar(require('pdfkit')))).default;
    const { company = {}, customer = {}, invoiceNo = '', date = '', ref = '', notes = '', items = [], isInterState = false, advancedPaymentAmount = 0 } = invoiceData;
    const L = 30; // left margin
    const R = 565; // right edge
    const W = R - L; // total width = 535
    const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNo}.pdf"`);
    doc.pipe(res);
    // ─── COLOURS / FONTS ───────────────────────────────────────────────────────
    const BLACK = '#000000';
    const DGREY = '#333333';
    const LGREY = '#f5f5f5';
    const BORDER = '#cccccc';
    const drawLine = (x1, y1, x2, y2, color = BORDER, w = 0.5) => doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(w).strokeColor(color).stroke();
    const drawRect = (x, y, w, h, fill = null, stroke = BORDER) => {
        doc.rect(x, y, w, h);
        if (fill && stroke)
            doc.fillAndStroke(fill, stroke);
        else if (fill) {
            doc.fillColor(fill).fill();
        }
        else {
            doc.lineWidth(0.5).strokeColor(stroke).stroke();
        }
    };
    // ─── DATA MAPPING ──────────────────────────────────────────────────────────
    const compName = company.name || company.unitName || company.legalName || 'Sunrise Bakery';
    const compAddr = company.address || company.addressLine1 || '';
    const compGST = company.gst || company.gstin || '';
    const compPhone = company.mobile || company.phone || '';
    const compEmail = company.email || '';
    const custName = customer.name || 'Unknown Customer';
    const custAddr1 = customer.address || customer.address1 || '';
    const custLoc = [customer.city, customer.state, customer.pin || customer.pincode].filter(Boolean).join(', ');
    const custGST = customer.gstin || customer.gst || '';
    const custContact = customer.contactPerson || customer.contact || '';
    // ─── SECTION 1: COMPANY HEADER ─────────────────────────────────────────────
    let y = 30;
    // Company Name (bold, large)
    doc.font('Helvetica-Bold').fontSize(15).fillColor(BLACK)
        .text(compName, L, y, { width: 400 });
    y += 20;
    // Address
    if (compAddr) {
        doc.font('Helvetica').fontSize(8.5).fillColor(DGREY)
            .text(compAddr, L, y, { width: 380 });
        y += 12;
    }
    // GST
    if (compGST) {
        doc.font('Helvetica').fontSize(8.5).fillColor(BLACK)
            .text(`GST : ${compGST}`, L, y, { width: 380 });
        y += 12;
    }
    // Phone
    if (compPhone) {
        doc.font('Helvetica').fontSize(8.5).fillColor(BLACK)
            .text(`Phone : ${compPhone}`, L, y, { width: 380 });
        y += 12;
    }
    // Email
    if (compEmail) {
        doc.font('Helvetica').fontSize(8.5).fillColor(BLACK)
            .text(`Email : ${compEmail}`, L, y, { width: 380 });
        y += 12;
    }
    y += 10; // gap after company block
    // ─── TITLE: Tax Invoice — centered, on its own full-width line ─────────────
    doc.font('Helvetica-Bold').fontSize(14).fillColor(BLACK)
        .text('Tax Invoice', L, y, { width: W, align: 'center' });
    y += 20;
    // ─── RIGHT BLOCK: Invoice No / Date / Ref — right-aligned at page right edge ─
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
        .text(`Invoice No. : ${String(invoiceNo)}`, L, y, { width: W, align: 'right' });
    y += 14;
    doc.font('Helvetica-Bold').fontSize(9)
        .text(`Date : ${String(date)}`, L, y, { width: W, align: 'right' });
    y += 14;
    if (ref) {
        doc.font('Helvetica-Bold').fontSize(9)
            .text(`Ref. : ${String(ref)}`, L, y, { width: W, align: 'right' });
        y += 14;
    }
    y += 6;
    // Separator line under header
    drawLine(L, y, R, y, BORDER, 0.8);
    y += 8;
    // ─── SECTION 2: BILLING / SHIPPING ADDRESS ─────────────────────────────────
    const halfW = W / 2;
    // Calculate height needed for address content
    let addrLines = 1; // name
    if (custContact)
        addrLines++;
    if (custAddr1)
        addrLines += 2;
    if (custLoc)
        addrLines++;
    if (custGST)
        addrLines++;
    const addrBoxH = Math.max(70, 14 + addrLines * 13);
    drawRect(L, y, W, addrBoxH, null, BORDER);
    drawLine(L + halfW, y, L + halfW, y + addrBoxH, BORDER);
    // Header rows with grey background
    drawRect(L, y, halfW, 14, LGREY, BORDER);
    drawRect(L + halfW, y, halfW, 14, LGREY, BORDER);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK);
    doc.text('Billing Address', L + 5, y + 3, { width: halfW - 10 });
    doc.text('Shipping Address', L + halfW + 5, y + 3, { width: halfW - 10 });
    let ay = y + 18;
    // Contact person (grey, smaller)
    if (custContact) {
        doc.font('Helvetica').fontSize(8).fillColor(DGREY)
            .text(custContact, L + 5, ay, { width: halfW - 10 });
        doc.text(custContact, L + halfW + 5, ay, { width: halfW - 10 });
        ay += 12;
    }
    // Customer name (bold)
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
        .text(custName, L + 5, ay, { width: halfW - 10 });
    doc.text(custName, L + halfW + 5, ay, { width: halfW - 10 });
    ay += 13;
    doc.font('Helvetica').fontSize(8).fillColor(BLACK);
    if (custAddr1) {
        doc.text(custAddr1, L + 5, ay, { width: halfW - 10 });
        doc.text(custAddr1, L + halfW + 5, ay, { width: halfW - 10 });
        ay += 12;
    }
    if (custLoc) {
        doc.text(custLoc, L + 5, ay, { width: halfW - 10 });
        doc.text(custLoc, L + halfW + 5, ay, { width: halfW - 10 });
        ay += 12;
    }
    if (custGST) {
        doc.font('Helvetica-Bold').text(`GSTIN : ${custGST}`, L + 5, ay, { width: halfW - 10 });
        doc.font('Helvetica-Bold').text(`GSTIN : ${custGST}`, L + halfW + 5, ay, { width: halfW - 10 });
        ay += 14;
    }
    y += addrBoxH + 6;
    // ─── SECTION 3: ITEMS TABLE ─────────────────────────────────────────────────
    const cols = [
        { label: 'No.', key: 'no', w: 20, align: 'center' },
        { label: 'Item & Description', key: 'desc', w: 140, align: 'left' },
        { label: 'HSN / SAC', key: 'hsn', w: 35, align: 'center' },
        { label: 'Qty', key: 'qty', w: 25, align: 'right' },
        { label: 'Unit', key: 'unit', w: 30, align: 'center' },
        { label: 'Rate (Rs.)', key: 'rate', w: 55, align: 'right' },
        { label: 'Less:\nDiscount\n(Rs.)', key: 'lessDisc', w: 45, align: 'right' },
        { label: 'Discount', key: 'disc', w: 30, align: 'right' },
        { label: 'Taxable (Rs.)', key: 'taxable', w: 55, align: 'right' },
        { label: 'MRP (Rs.)', key: 'mrp', w: 45, align: 'right' },
        { label: 'Amount (Rs.)', key: 'amount', w: 55, align: 'right' },
    ];
    // Calculate starting x for each column
    let cx = L;
    cols.forEach(c => { c.x = cx; cx += c.w; });
    const tblHeaderH = 34;
    const rowH = 22;
    // Draw header background
    drawRect(L, y, W, tblHeaderH, LGREY, BORDER);
    // Vertical lines for header
    let vx = L;
    cols.forEach((c, i) => {
        if (i > 0)
            drawLine(vx, y, vx, y + tblHeaderH, BORDER);
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(BLACK)
            .text(c.label, c.x + 2, y + 4, { width: c.w - 4, align: c.align, lineGap: 1 });
        vx += c.w;
    });
    drawLine(L, y, R, y, BORDER);
    drawLine(L, y + tblHeaderH, R, y + tblHeaderH, BORDER);
    y += tblHeaderH;
    // ─── ROWS ──────────────────────────────────────────────────────────────────
    let grandSubtotal = 0;
    let grandDiscount = 0;
    let grandTaxable = 0;
    let grandAmount = 0;
    items.forEach((item, idx) => {
        const qty = parseFloat(item.quantity || item.qty || item.qtyIssued || 0);
        const rate = parseFloat(item.rate || item.unitPrice || item.salePrice || 0);
        const discPct = parseFloat(item.discountPct || item.discount || 0);
        const hsn = item.hsn || '';
        const unit = item.unit || 'nos';
        const name = item.productName || item.name || '';
        const mrp = parseFloat(item.mrp || rate);
        const lessDisc = parseFloat(((rate * qty) - (rate * qty * (1 - discPct / 100))).toFixed(2));
        const taxable = parseFloat((rate * qty * (1 - discPct / 100)).toFixed(2));
        const amount = taxable;
        grandSubtotal += rate * qty;
        grandDiscount += lessDisc;
        grandTaxable += taxable;
        grandAmount += amount;
        // Alternate row background
        if (idx % 2 === 0)
            drawRect(L, y, W, rowH, '#ffffff', BORDER);
        else
            drawRect(L, y, W, rowH, LGREY, BORDER);
        // Cell values
        const row = {
            no: String(idx + 1),
            desc: name,
            hsn: hsn,
            qty: qty % 1 === 0 ? String(qty) : qty.toFixed(2),
            unit: unit,
            rate: rate.toFixed(2),
            lessDisc: lessDisc > 0 ? lessDisc.toFixed(2) : '—',
            disc: discPct > 0 ? `${discPct.toFixed(2)}%` : '—',
            taxable: taxable.toFixed(2),
            mrp: mrp.toFixed(2),
            amount: amount.toFixed(2),
        };
        // Draw vertical lines and text
        let rvx = L;
        cols.forEach((c, i) => {
            if (i > 0)
                drawLine(rvx, y, rvx, y + rowH, BORDER);
            doc.font('Helvetica').fontSize(7).fillColor(BLACK)
                .text(row[c.key], c.x + 2, y + 6, { width: c.w - 4, align: c.align, ellipsis: true });
            rvx += c.w;
        });
        drawLine(L, y + rowH, R, y + rowH, BORDER);
        y += rowH;
        // Page break safety
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
        mrp: '',
        amount: grandAmount.toFixed(2),
    };
    cols.forEach((c, i) => {
        if (i > 0)
            drawLine(rvx2, y, rvx2, y + totRowH, BORDER);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BLACK)
            .text(totals[c.key], c.x + 2, y + 5, { width: c.w - 4, align: c.align });
        rvx2 += c.w;
    });
    drawLine(L, y + totRowH, R, y + totRowH, BORDER);
    y += totRowH + 5;
    // ─── SECTION 4: AMOUNT IN WORDS + GRAND TOTAL BOX ──────────────────────────
    const advPaid = parseFloat(advancedPaymentAmount || 0);
    const netPayable = Math.max(0, Math.round(grandAmount) - advPaid);
    const footerH = advPaid > 0 ? 56 : 38;
    drawRect(L, y, W, footerH, null, BORDER);
    drawLine(L + W * 0.53, y, L + W * 0.53, y + footerH, BORDER);
    const roundOff = parseFloat((Math.round(grandAmount) - grandAmount).toFixed(2));
    const grandTotal = Math.round(grandAmount);
    // Amount in words uses net payable if advanced exists, else grand total
    const amountForWords = advPaid > 0 ? netPayable : grandTotal;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
        .text('Total Invoice Amount in Words :', L + 5, y + 5);
    doc.font('Helvetica').fontSize(8).fillColor(BLACK)
        .text((0, exports.convertNumberToWords)(amountForWords), L + 5, y + 17, { width: W * 0.53 - 10 });
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
    if (advPaid > 0) {
        drawLine(L + W * 0.53, y + 38, R, y + 38, BORDER);
        doc.font('Helvetica').fontSize(8.5).fillColor('#c0392b')
            .text('Less: Advanced Paid (Rs.)', rtX, y + 41, { width: rtW - 60, align: 'left' });
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#c0392b')
            .text(`(${advPaid.toFixed(2)})`, rtX + rtW - 60, y + 41, { width: 60, align: 'right' });
        drawLine(L + W * 0.53, y + 54, R, y + 54, BORDER);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1a5276')
            .text('Net Payable (Rs.)', rtX, y + 57, { width: rtW - 60, align: 'left' });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1a5276')
            .text(netPayable.toFixed(2), rtX + rtW - 60, y + 57, { width: 60, align: 'right' });
    }
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
        .text('This is a computer-generated invoice. E. & O. E.', L + 5, y + sigBoxH - 12, { width: W * 0.55 - 10 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
        .text(`For, ${company.name || ''}`, L + W * 0.55 + 5, y + 8, { width: W * 0.45 - 10, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
        .text('Authorised Signatory', L + W * 0.55 + 5, y + sigBoxH - 14, { width: W * 0.45 - 10, align: 'center' });
    doc.end();
});
exports.generateStandardizedInvoicePDF = generateStandardizedInvoicePDF;
