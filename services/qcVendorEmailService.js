// QC results email to the vendor (client, 2026-10-29;
// docs/procurement-v2/qc-result-vendor-email-2026-10.md).
//
// Once a day, for each PO with QC results the vendor hasn't been told about
// yet → one email: what was accepted, what wasn't (QC's reason — Purchase
// still settles it with the vendor in QC Rejections), what's still to come,
// and — the day the PO becomes fully accepted — "all passed" with the
// payment due date. Each result is stamped when its email goes; nothing is
// stamped when it can't go, so the next run carries it.
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import PurchaseRejection from '../models/PurchaseRejection.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import { Company } from '../models/Company.js';
import { DEPARTMENTS, getDeptMailer, reportMissingMailbox } from '../config/mailAccounts.js';
import { sendQcResultEmail } from './emailService.js';
import { formatDims } from './fabricationDemandService.js';
import { prIdsOfLine } from './purchaseAcceptanceService.js';
import { logPoEvent } from './purchaseAuditService.js';
import { fmtDay } from './deliveryFollowUpService.js';

// Results from before the feature went live are never emailed (otherwise
// the first run would send every vendor weeks of old passes).
export const QC_VENDOR_EMAIL_FROM = new Date(2026, 9, 30);

const sizeOf = (pr) => {
  const v = pr?.fabricationDimensionLines?.[0]?.values;
  return v ? formatDims(v) : '';
};

// QC's photos of the rejected material as email attachments (2026-10-30):
// named by the rejection (REJ-0012-1.jpg …), at most MAX_PHOTOS per email; a
// photo whose file is missing is skipped — it never blocks the email.
export const MAX_PHOTOS = 10;
const SERVER_DIR = fs.existsSync(path.join(process.cwd(), 'server', 'index.js')) ? path.join(process.cwd(), 'server') : process.cwd();
export function photoAttachments(rejections) {
  const attachments = [];
  let more = 0;
  for (const r of rejections || []) {
    (r.photos || []).forEach((p, i) => {
      const file = [path.join(process.cwd(), p.url), path.join(SERVER_DIR, p.url)].find(f => fs.existsSync(f));
      if (!file) return;
      if (attachments.length >= MAX_PHOTOS) { more += 1; return; }
      attachments.push({ filename: `${r.number || 'REJ'}-${i + 1}${path.extname(p.url) || '.jpg'}`, path: file });
    });
  }
  return { attachments, more };
}

// ── Pure ──────────────────────────────────────────────────────────────────

// Where each live line stands: null = received and QC has decided all of it;
// else 'to come' (not received yet — a replacement included) or 'with QC'.
export function lineStanding(line, prsById, jobsByPr) {
  if (line.cancelled?.at) return null;
  let withQc = false;
  for (const id of prIdsOfLine(line)) {
    const pr = prsById.get(id);
    if (!pr || pr.status !== 'Received') return 'to come';
    const job = jobsByPr.get(id);
    if (!job || !['Approved', 'Rejected'].includes(job.status)) withQc = true;
  }
  return withQc ? 'with QC' : null;
}

// ── DB ────────────────────────────────────────────────────────────────────

export async function runQcVendorEmailSweep(now = new Date(), { companyId = null, mailer: givenMailer = null } = {}) {
  const QCJob = mongoose.model('QCJob');
  const PurchaseRequest = mongoose.model('PurchaseRequest');
  const Purchase = mongoose.model('Purchase');
  const scope = (field) => (companyId ? { [field]: companyId } : {});

  // Everything not yet told, grouped by PO.
  const jobs = await QCJob.find({
    source: 'Purchase', purchaseRequestId: { $ne: null },
    'acceptance.postedAt': { $gte: QC_VENDOR_EMAIL_FROM, $lte: now },
    'acceptance.vendorMailedAt': null,
    ...scope('company'),
  }).select('purchaseRequestId acceptedQty quantity unit itemName').lean();
  const rejections = await PurchaseRejection.find({
    createdAt: { $gte: QC_VENDOR_EMAIL_FROM, $lte: now }, vendorMailedAt: null, ...scope('companyId'),
  }).lean();
  const bills = await PurchaseInvoice.find({
    purchaseOrder: { $ne: null },
    fullyAcceptedAt: { $gte: QC_VENDOR_EMAIL_FROM, $lte: now }, fullyAcceptedMailedAt: null, ...scope('companyId'),
  }).select('purchaseOrder totalAmount paidAmount dueDate creditDays').lean();

  const jobPrs = await PurchaseRequest.find({ _id: { $in: jobs.map(j => j.purchaseRequestId) } })
    .select('purchaseOrder replacementFor fabricationDimensionLines').lean();
  const jobPrById = new Map(jobPrs.map(p => [String(p._id), p]));
  const byPo = new Map();
  const slot = (poId) => {
    const k = String(poId);
    if (!byPo.has(k)) byPo.set(k, { passes: [], rejections: [], bill: null });
    return byPo.get(k);
  };
  for (const j of jobs) {
    const pr = jobPrById.get(String(j.purchaseRequestId));
    if (pr?.purchaseOrder) slot(pr.purchaseOrder).passes.push({ job: j, pr });
  }
  for (const r of rejections) slot(r.purchaseOrder).rejections.push(r);
  for (const b of bills) slot(b.purchaseOrder).bill = b;
  if (!byPo.size) return { pos: 0, sent: 0, skipped: 0 };

  const mailer = givenMailer || await getDeptMailer(DEPARTMENTS.PURCHASE);
  if (!mailer) {
    console.log('[EMAIL SKIPPED] Purchase SMTP not configured — QC results to vendors wait for the next run.');
    const companies = await Purchase.distinct('companyId', { _id: { $in: [...byPo.keys()] } });
    for (const c of companies) await reportMissingMailbox(DEPARTMENTS.PURCHASE, { companyId: c, what: 'QC results to vendors' });
    return { pos: byPo.size, sent: 0, skipped: byPo.size, notConfigured: true };
  }

  let sent = 0;
  let skipped = 0;
  for (const [poId, got] of byPo) {
    const po = await Purchase.findById(poId).populate('supplier', 'supplierName email').lean();
    if (!po) { skipped += 1; continue; }
    if (!po.supplier?.email) { skipped += 1; continue; } // nothing sent or stamped

    // The rejections' sizes (their requests).
    const rejPrs = await PurchaseRequest.find({ _id: { $in: got.rejections.map(r => r.purchaseRequest) } })
      .select('fabricationDimensionLines').lean();
    const rejPrById = new Map(rejPrs.map(p => [String(p._id), p]));

    // Where the PO stands.
    const lineIds = [...new Set((po.items || []).flatMap(prIdsOfLine))];
    const prs = await PurchaseRequest.find({ _id: { $in: lineIds } }).select('status').lean();
    const lineJobs = await QCJob.find({ source: 'Purchase', purchaseRequestId: { $in: lineIds } }).select('purchaseRequestId status').lean();
    const prsById = new Map(prs.map(p => [String(p._id), p]));
    const jobsByPr = new Map(lineJobs.map(j => [String(j.purchaseRequestId), j]));
    const pending = (po.items || [])
      .map(l => ({ itemName: l.itemName, standing: lineStanding(l, prsById, jobsByPr) }))
      .filter(x => x.standing);

    const accepted = got.passes.map(({ job, pr }) => ({
      itemName: job.itemName, size: sizeOf(pr), qty: Number(job.acceptedQty ?? job.quantity) || 0, unit: job.unit || '',
      replacement: !!pr.replacementFor,
    }));
    const notAccepted = got.rejections.map(r => ({
      itemName: r.itemName, size: sizeOf(rejPrById.get(String(r.purchaseRequest))), qty: r.rejectedQty, unit: r.qtyUnit || '',
      // A breakdown line says what failed + QC's remark once; an older one
      // its reason + the checks that failed (2026-10-30).
      reason: (r.lines || []).length ? 'Reasons below' : r.parameter ? `${r.parameter} — ${r.remark || r.reason || ''}` : (r.reason || ''),
      failedChecks: (r.lines || []).length
        ? r.lines.map(l => `${l.qty} × ${l.parameter} — ${l.remark}`)
        : r.parameter ? [] : (r.failedChecks || []).map(c => `${c.parameter}${c.remarks ? ` — ${c.remarks}` : ''}`),
      number: r.number,
    }));
    const photoFiles = photoAttachments(got.rejections);
    let allPassed = null;
    if (got.bill) {
      const balance = Math.round(((Number(got.bill.totalAmount) || 0) - (Number(got.bill.paidAmount) || 0)) * 100) / 100;
      allPassed = { balance, dueDate: got.bill.dueDate, creditDays: got.bill.creditDays };
    }

    const company = await Company.findById(po.companyId).select('name').lean();
    const result = await sendQcResultEmail({
      mailer,
      to: po.supplier.email,
      vendorName: po.supplier.supplierName || 'Vendor',
      companyName: company?.name || 'Samtek',
      poNumber: po.purchaseOrderNumber,
      accepted, notAccepted, pending, allPassed,
      attachments: photoFiles.attachments, morePhotos: photoFiles.more,
    });
    if (!result.success) { skipped += 1; continue; }

    const at = new Date();
    if (got.passes.length) await QCJob.updateMany({ _id: { $in: got.passes.map(p => p.job._id) } }, { $set: { 'acceptance.vendorMailedAt': at } });
    if (got.rejections.length) await PurchaseRejection.updateMany({ _id: { $in: got.rejections.map(r => r._id) } }, { $set: { vendorMailedAt: at } });
    if (got.bill) await PurchaseInvoice.updateOne({ _id: got.bill._id }, { $set: { fullyAcceptedMailedAt: at } });
    const parts = [
      accepted.length ? `${accepted.length} accepted` : '',
      notAccepted.length ? `${notAccepted.length} not accepted` : '',
      allPassed ? `all passed${allPassed.balance > 0 && allPassed.dueDate ? ` (payment due ${fmtDay(allPassed.dueDate)})` : ''}` : '',
    ].filter(Boolean).join(', ');
    await logPoEvent({
      po, user: null, action: 'qc_results_emailed',
      summary: `QC results emailed to the vendor (${po.supplier.email}): ${parts}.`,
      details: { to: po.supplier.email, accepted, notAccepted, pending, allPassed },
    });
    sent += 1;
  }
  return { pos: byPo.size, sent, skipped };
}
