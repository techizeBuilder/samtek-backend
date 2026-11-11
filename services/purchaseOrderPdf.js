import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { formatDims } from './fabricationDemandService.js';
import { convertNumberToWords } from '../utils/invoicePdf.js';
import { Company } from '../models/Company.js';

/**
 * The Purchase Order document (client, 2026-10-29) — ONE PDF for every way a
 * PO reaches the vendor: "Download PO" (Purchase sends it on WhatsApp etc.)
 * and the PO email (attached). Company logo + name / address / GSTIN at the
 * top, the company name as a faded diagonal watermark on every page, the
 * vendor, every line (code, size, qty + unit, rate, GST, amount, due date,
 * warranty), charges, CGST/SGST or IGST, grand total in words, payment terms,
 * delivery address, transport, notes, and "For <company>" with the stamp.
 *
 * Totals are the same figures the PO email always showed. Amounts are
 * written "Rs." — pdfkit's built-in Helvetica has no ₹ glyph.
 *
 * Returns a Buffer.
 */

const L = 36;
const R = 559;
const W = R - L;
const BOTTOM = 800;
const INK = '#111827';
const GREY = '#4b5563';
const LIGHT = '#6b7280';
const RULE = '#d1d5db';
const HEAD_BG = '#eef2ff';
const ACCENT = '#1e3a8a';

const rs = (n) => `Rs. ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// The server folder — uploads live under it. Started from server/ (nodemon)
// or from the repo root. No import.meta here: the dev server runs through
// ts-node, which compiles to CommonJS and crashes on it.
const SERVER_DIR = fs.existsSync(path.join(process.cwd(), 'server', 'index.js'))
  ? path.join(process.cwd(), 'server')
  : process.cwd();
// The default Samtek logo, as on Quotation / the Sidebar when a company has
// no logo of its own (or its file is gone).
const DEFAULT_LOGO = path.join(SERVER_DIR, 'assets', 'logo Semtek.png');

// pdfkit draws JPG / PNG only — a WEBP upload (allowed) can't be drawn.
function imagePath(url) {
  if (!url) return null;
  const ext = path.extname(url).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) return null;
  return [path.join(process.cwd(), url), path.join(SERVER_DIR, url)].find(p => fs.existsSync(p)) || null;
}

function logoPath(company) {
  const own = imagePath(company.logoUrl);
  if (own) return own;
  // A WEBP logo of their own: name only, never someone else's logo.
  if (company.logoUrl && !/\.(jpe?g|png)$/i.test(company.logoUrl)) return null;
  return fs.existsSync(DEFAULT_LOGO) ? DEFAULT_LOGO : null;
}

const vendorAddress = (s) => {
  const a = s?.address || {};
  return [a.street, [a.city, a.state].filter(Boolean).join(', '), a.zipCode].filter(Boolean).join(', ');
};

export function buildPurchaseOrderPdf({ purchase, company = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const companyName = company.name || company.legalName || company.unitName || 'Company';
    const poNumber = purchase.purchaseOrderNumber || '';
    const vendor = purchase.supplier || {};
    const lines = (purchase.items || []).filter(l => !l.cancelled?.at);
    const onAdvance = purchase.deliveryClock?.startsOn === 'advance' && !purchase.deliveryClock?.startedAt;
    const deliverBy = (it) => (onAdvance
      ? (Number(it.deliveryDays) > 0 ? `${it.deliveryDays} days after advance` : 'After advance')
      : day(it.expectedDeliveryDate || purchase.expectedDeliveryDate));

    const rule = (y, color = RULE, w = 0.6) => doc.moveTo(L, y).lineTo(R, y).lineWidth(w).strokeColor(color).stroke();

    // ── Header ──────────────────────────────────────────────────────────────
    let y = 32;
    const logo = logoPath(company);
    let textX = L;
    if (logo) {
      // Up to 120 wide × 60 high, keeping its shape (wide logos stay readable).
      try {
        const img = doc.openImage(logo);
        const scale = Math.min(120 / img.width, 60 / img.height);
        doc.image(img, L, y, { width: img.width * scale, height: img.height * scale });
        textX = L + img.width * scale + 12;
      } catch { /* unreadable image — name only */ }
    }
    // The company column ends before the PO number block on the right.
    const headW = R - 175 - textX;
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(companyName, textX, y, { width: headW });
    let cy = doc.y + 2;
    const companyAddr = [company.address, [company.city, company.state].filter(Boolean).join(', '), company.locationPin].filter(Boolean).join(', ');
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY);
    if (companyAddr) { doc.text(companyAddr, textX, cy, { width: headW }); cy = doc.y + 1; }
    if (company.gst) { doc.text(`GSTIN: ${company.gst}`, textX, cy, { width: headW }); cy = doc.y + 1; }
    const contact = [company.mobile && `Phone: ${company.mobile}`, company.email && `Email: ${company.email}`].filter(Boolean).join('   ');
    if (contact) { doc.text(contact, textX, cy, { width: headW }); cy = doc.y + 1; }

    doc.font('Helvetica-Bold').fontSize(16).fillColor(ACCENT).text('PURCHASE ORDER', R - 200, y, { width: 200, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(INK)
      .text(`PO No: ${poNumber}`, R - 200, y + 24, { width: 200, align: 'right' })
      .text(`Date: ${day(purchase.orderDate || purchase.createdAt)}`, R - 200, y + 37, { width: 200, align: 'right' });

    y = Math.max(cy, y + 64) + 10;
    rule(y, ACCENT, 1.2);
    y += 10;

    // ── Vendor | Deliver to ─────────────────────────────────────────────────
    const half = W / 2 - 8;
    const blockTop = y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(LIGHT).text('VENDOR', L, y, { width: half, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(vendor.supplierName || 'Vendor', L, doc.y + 2, { width: half });
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY);
    const vAddr = vendorAddress(vendor);
    if (vAddr) doc.text(vAddr, L, doc.y + 1, { width: half });
    if (vendor.gstNumber) doc.text(`GSTIN: ${vendor.gstNumber}`, L, doc.y + 1, { width: half });
    const vContact = [vendor.contactPerson, vendor.phone, vendor.email].filter(Boolean).join(' · ');
    if (vContact) doc.text(vContact, L, doc.y + 1, { width: half });
    const leftEnd = doc.y;

    const rx = L + W / 2 + 8;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(LIGHT).text('DELIVER TO', rx, blockTop, { width: half, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(purchase.deliveryAddress || companyAddr || '—', rx, doc.y + 2, { width: half });
    doc.fillColor(GREY).text(`Transport: ${purchase.transportBy === 'Company' ? 'We will collect the goods from you' : 'Vendor delivers to the address above'}`, rx, doc.y + 3, { width: half });
    y = Math.max(leftEnd, doc.y) + 14;

    // ── Items table ─────────────────────────────────────────────────────────
    const cols = [
      { key: 'n', label: '#', w: 20, align: 'left' },
      { key: 'item', label: 'Item', w: 197, align: 'left' },
      { key: 'qty', label: 'Qty', w: 62, align: 'right' },
      { key: 'rate', label: 'Rate', w: 64, align: 'right' },
      { key: 'gst', label: 'GST', w: 36, align: 'right' },
      { key: 'amt', label: 'Amount', w: 72, align: 'right' },
      { key: 'due', label: 'Deliver by', w: 72, align: 'right' },
    ];
    const PAD = 4;
    const tableHeader = () => {
      doc.rect(L, y, W, 18).fillColor(HEAD_BG).fill();
      let x = L;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ACCENT);
      for (const c of cols) { doc.text(c.label, x + PAD, y + 5, { width: c.w - PAD * 2, align: c.align }); x += c.w; }
      y += 18;
    };
    const newPage = () => { doc.addPage(); y = 40; };
    tableHeader();

    lines.forEach((it, i) => {
      const dims = (it.fabricationDimensionLines || []).map(l => `${formatDims(l.values)} × ${l.quantity} pcs`);
      const sub = [
        it.item?.code ? `Code: ${it.item.code}` : '',
        ...dims,
        Number(it.warrantyMonths) > 0 ? `Warranty: ${it.warrantyMonths} months` : '',
      ].filter(Boolean).join('\n');
      const amount = (Number(it.totalPrice) || 0) + (Number(it.gstAmount) || 0);
      const cells = {
        n: String(i + 1),
        item: it.itemName || it.item?.name || 'Item',
        qty: `${it.quantity}${it.purchaseUnit ? ` ${it.purchaseUnit}` : ''}`,
        rate: rs(it.unitPrice),
        gst: it.gstInclusive ? (Number(it.gstRate) > 0 ? `${it.gstRate}% incl.` : 'incl.') : `${Number(it.gstRate) || 0}%`,
        amt: rs(amount),
        due: deliverBy(it),
      };
      const itemW = cols[1].w - PAD * 2;
      doc.font('Helvetica-Bold').fontSize(8.5);
      let h = doc.heightOfString(cells.item, { width: itemW });
      doc.font('Helvetica').fontSize(7.5);
      if (sub) h += doc.heightOfString(sub, { width: itemW }) + 2;
      if (dims.length) h = Math.max(h, 22);
      const rowH = h + PAD * 2 + 2;
      if (y + rowH > BOTTOM) { newPage(); tableHeader(); }

      let x = L;
      for (const c of cols) {
        if (c.key === 'item') {
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(cells.item, x + PAD, y + PAD, { width: itemW });
          if (sub) doc.font('Helvetica').fontSize(7.5).fillColor(LIGHT).text(sub, x + PAD, doc.y + 2, { width: itemW });
        } else {
          doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(cells[c.key], x + PAD, y + PAD, { width: c.w - PAD * 2, align: c.align });
          if (c.key === 'qty' && dims.length) doc.fontSize(7).fillColor(LIGHT).text('(calc. weight)', x + PAD, doc.y + 1, { width: c.w - PAD * 2, align: 'right' });
        }
        x += c.w;
      }
      y += rowH;
      rule(y);
    });

    // ── Charges + totals ────────────────────────────────────────────────────
    const charges = purchase.charges || [];
    const goods = Number(purchase.totalAmount) || 0;
    const gstTotal = (Number(purchase.taxAmount) || 0) + (Number(purchase.chargesGstTotal) || 0);
    const chargesTotal = (Number(purchase.chargesTotal) || 0) + (Number(purchase.poChargesTotal) || 0);
    // GST already inside a GST-inclusive rate (2026-10-30): shown as "… included
    // in rates" (for information — it doesn't add to the total), never a bare
    // "IGST Rs. 0.00" that reads as "no tax".
    const includedGst = Math.round(lines.reduce((sum, it) => {
      const rate = Number(it.gstRate) || 0;
      if (!it.gstInclusive || rate <= 0) return sum;
      const amount = Number(it.totalPrice) || 0;
      return sum + (amount - amount / (1 + rate / 100));
    }, 0) * 100) / 100;
    const allInclusive = lines.length > 0 && lines.every(it => it.gstInclusive);
    const split = purchase.gstSplit?.type;
    const gstRows = (amount, suffix = '', note = false) => (split === 'CGST_SGST'
      ? [[`CGST${suffix}`, rs(amount / 2), note], [`SGST${suffix}`, rs(amount / 2), note]]
      : [[`${split === 'IGST' ? 'IGST' : 'GST'}${suffix}`, rs(amount), note]]);
    const totalRows = [
      [allInclusive ? 'Goods (incl. GST)' : 'Goods', rs(goods)],
      // A charge before GST — its GST is in the CGST/SGST (IGST) rows below,
      // so the rows add up to the grand total.
      ...charges.map(c => [`${c.label}${c.gstPercent ? ` (+${c.gstPercent}% GST)` : ''}`, rs(c.amount)]),
      ...(!charges.length && chargesTotal ? [['Charges', rs(chargesTotal)]] : []),
      ...(gstTotal > 0 || includedGst <= 0 ? gstRows(gstTotal) : []),
      ...(includedGst > 0 ? gstRows(includedGst, ' included in rates', true) : []),
    ];
    const totalsH = totalRows.length * 14 + 40;
    if (y + 10 + totalsH > BOTTOM) newPage();
    y += 10;
    const tx = R - 230;
    doc.font('Helvetica').fontSize(9);
    for (const [label, value, note] of totalRows) {
      // An "included" row is information only — lighter, in italics.
      doc.font(note ? 'Helvetica-Oblique' : 'Helvetica').fontSize(note ? 8.5 : 9);
      doc.fillColor(note ? LIGHT : GREY).text(label, tx, y, { width: 140 });
      doc.fillColor(note ? LIGHT : INK).text(note ? `(${value})` : value, tx + 140, y, { width: 90, align: 'right' });
      y += 14;
    }
    doc.font('Helvetica').fontSize(9);
    doc.moveTo(tx, y).lineTo(R, y).lineWidth(0.8).strokeColor(INK).stroke();
    y += 5;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ACCENT).text('Grand Total', tx, y, { width: 120 })
      .text(rs(purchase.grandTotal), tx + 110, y, { width: 120, align: 'right' });
    y += 18;
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(GREY)
      .text(`Amount in words: ${convertNumberToWords(Number(purchase.grandTotal) || 0)}`, L, y, { width: W, align: 'right' });
    y = doc.y + 12;

    // ── Payment terms, notes ────────────────────────────────────────────────
    const terms = purchase.paymentTerms || {};
    const termLines = [
      terms.advancePercent != null ? `Advance: ${terms.advancePercent}%` : '',
      terms.creditDays != null ? `Credit: ${terms.creditDays} days` : '',
      ...(terms.others || []).map(o => `${o.label}: ${o.value}`),
    ].filter(Boolean);
    // ── Sign-off on the right, beside the terms (not alone on a new page) ──
    const SIGN_W = 200;
    const SIGN_H = 82;
    if (y + SIGN_H > BOTTOM) newPage();
    const sx = R - SIGN_W;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`For ${companyName}`, sx, y, { width: SIGN_W, align: 'center' });
    const stamp = imagePath(company.stampUrl);
    if (stamp) {
      try { doc.image(stamp, sx + 72, y + 16, { fit: [56, 44] }); } catch { /* no stamp */ }
    }
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text('Authorised Signatory', sx, y + 66, { width: SIGN_W, align: 'center' });
    const signEnd = y + SIGN_H;

    const TW = W - SIGN_W - 20; // the terms column, left of the sign-off
    const section = (title, body) => {
      doc.font('Helvetica').fontSize(8.5);
      const need = doc.heightOfString(body, { width: TW }) + 20;
      if (y + need > BOTTOM) newPage();
      doc.font('Helvetica-Bold').fontSize(8).fillColor(LIGHT).text(title, L, y, { width: TW, characterSpacing: 0.5 });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(body, L, doc.y + 3, { width: TW });
      y = doc.y + 10;
    };
    if (termLines.length) section('PAYMENT TERMS', termLines.join('\n'));
    if (onAdvance) section('DELIVERY', 'Delivery times count from the day we pay the advance.');
    if (purchase.notes) section('NOTES', purchase.notes);
    section('PLEASE NOTE', `Quote PO number ${poNumber} on your invoice and delivery challan.`);
    y = Math.max(y, signEnd);

    // ── Every page: watermark + footer ──────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      doc.save();
      doc.rotate(-35, { origin: [297, 421] });
      // Sized so the name fits across the page's diagonal.
      doc.font('Helvetica-Bold').fontSize(Math.max(22, Math.min(58, Math.floor(1050 / Math.max(companyName.length, 1))))).fillColor(ACCENT).fillOpacity(0.07)
        .text(companyName.toUpperCase(), -60, 395, { width: 715, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
      doc.font('Helvetica').fontSize(7.5).fillColor(LIGHT)
        .text(`${poNumber} · Page ${p - range.start + 1} of ${range.count}`, L, 816, { width: W, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

// Loads what the document needs and builds it (download + email share this).
export async function purchaseOrderPdfFor(po) {
  const company = await Company.findById(po.companyId)
    .select('name legalName unitName address city state locationPin gst mobile email logoUrl stampUrl').lean();
  return buildPurchaseOrderPdf({ purchase: po, company: company || {} });
}
