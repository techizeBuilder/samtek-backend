// Company Admin → Purchase & Vendor Approval → PO Approvals (procurement-v2,
// 2026-10-08). A PO whose final total is above the company's
// poApprovalThreshold is saved as 'Pending Approval' with no side effects
// (purchaseController.createPurchase). Approving runs finalizePurchase —
// the same step a PO under the threshold runs straight away — after
// re-checking nothing moved while it waited. Rejecting marks it 'Rejected':
// nothing was ever linked, so the item groups simply unlock on RFQ/PO.
import Purchase from '../models/Purchase.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import PurchaseInvoice from '../models/PurchaseInvoice.js';
import { cancellableLines, cancelKind } from '../services/poCancellationService.js';
import { logPoEvent } from '../services/purchaseAuditService.js';
import notificationService from '../services/notificationService.js';
import { finalizePurchase, checkPurchaseStillValid } from './purchaseController.js';
import { buildQuoteHistory } from './itemQuoteGroupController.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';
import {
  loadPriceSamples, summarizePrices, vendorPriceCheck, exGstPrice, DEFAULT_PRICE_JUMP_WARN_PERCENT,
} from '../services/quoteChecksService.js';

const STATUS_QUERY = {
  // A PO waiting for approval, or a real PO Purchase asked to cancel (gap 13).
  Pending: { $or: [{ status: 'Pending Approval' }, { cancellations: { $elemMatch: { status: 'Requested' } } }] },
  // Every REAL PO (procurement-v2): approved by the Company Admin, or created
  // directly within the limit / with no limit set — the Company Admin sees all.
  Approved: { status: { $nin: ['Pending Approval', 'Rejected'] } },
  Rejected: { status: 'Rejected' },
};

// GET /api/po-approvals?status=Pending|Approved|Rejected
export const listPOApprovals = async (req, res) => {
  try {
    if (!req.user.companyId) return res.status(400).json({ message: 'Your account is not linked to a company.' });
    const status = STATUS_QUERY[req.query.status] ? req.query.status : 'Pending';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const query = { companyId: req.user.companyId, ...STATUS_QUERY[status] };
    const total = await Purchase.countDocuments(query);
    const purchases = await Purchase.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('supplier', 'supplierName supplierCode contactPerson phone email')
      .populate('items.item', 'name code')
      .populate('approval.requestedBy', 'fullName username')
      .populate('approval.reviewedBy', 'fullName username')
      .populate('createdBy', 'fullName username')
      .populate('cancellations.requestedBy', 'fullName username')
      .populate('cancellations.reviewedBy', 'fullName username')
      .lean();
    // "Bought before" check (2026-10-09): each line against what was paid on
    // earlier DELIVERED purchases of the item, before this PO (same unit,
    // before GST) — compared with this PO's vendor's own last price; the
    // whole history (every vendor) goes along for the pop-up. Warning only.
    const settings = await getOrCreateSettings(req.user.companyId);
    const samples = await loadPriceSamples({
      companyId: req.user.companyId,
      itemIds: purchases.flatMap(p => (p.items || []).map(l => l.item?._id || l.item)),
    });
    const priceCheckOf = (po, line) => {
      const itemId = line.item?._id || line.item;
      if (!itemId) return null;
      const history = summarizePrices(samples.get(String(itemId)) || [], { unit: line.purchaseUnit, excludePurchaseId: po._id, before: po.createdAt });
      if (!history) return null;
      const comparable = line.gstInclusive && !(Number(line.gstRate) > 0) ? null : exGstPrice(line.unitPrice, line.gstInclusive, line.gstRate);
      return {
        history,
        comparablePrice: comparable,
        ...vendorPriceCheck(history, po.supplier?._id || po.supplier, comparable),
      };
    };

    // A waiting cancellation (gap 13): which lines it would take NOW (Store
    // may have received some meanwhile), and what was already paid.
    const withCancel = purchases.filter(p => (p.cancellations || []).some(c => c.status === 'Requested'));
    const cancelPreview = new Map();
    if (withCancel.length) {
      const prIds = withCancel.flatMap(p => (p.items || []).flatMap(l => (l.purchaseRequests?.length ? l.purchaseRequests : (l.purchaseRequest ? [l.purchaseRequest] : []))));
      const prs = await PurchaseRequest.find({ _id: { $in: prIds } }).select('requestId status').lean();
      const prsById = new Map(prs.map(pr => [String(pr._id), pr]));
      const invoices = await PurchaseInvoice.find({ purchaseOrder: { $in: withCancel.map(p => p._id) } }).select('purchaseOrder invoiceNo totalAmount paidAmount status').lean();
      for (const p of withCancel) {
        const lines = cancellableLines(p, prsById);
        const inv = invoices.find(i => String(i.purchaseOrder) === String(p._id)) || null;
        cancelPreview.set(String(p._id), {
          kind: lines.length ? cancelKind(p, lines) : null,
          lineIds: lines.map(l => String(l._id)),
          requests: Object.fromEntries(lines.flatMap(l => (l.purchaseRequests?.length ? l.purchaseRequests : (l.purchaseRequest ? [l.purchaseRequest] : []))).map(id => [String(id), prsById.get(String(id))?.requestId || ''])),
          invoice: inv ? { invoiceNo: inv.invoiceNo, totalAmount: inv.totalAmount, paidAmount: inv.paidAmount || 0 } : null,
        });
      }
    }

    // How each real PO got approved — shown as a badge on the Approved list.
    const withMode = purchases.map(p => ({
      ...p,
      items: (p.items || []).map(l => ({ ...l, priceCheck: priceCheckOf(p, l) })),
      approvalMode: p.status === 'Pending Approval' ? 'pending'
        : p.status === 'Rejected' ? 'rejected'
          : p.approval?.required && p.approval?.decision === 'Approved' ? 'approved'
            : p.approval?.threshold != null ? 'within-limit'
              : 'no-limit',
      // Why it needed approval: 'threshold' and/or 'selection' (gap 12).
      // POs from before 2026-10-09 saved no reasons — those were all the limit.
      approvalReasons: p.approval?.reasons?.length ? p.approval.reasons : (p.approval?.required ? ['threshold'] : []),
      // What the Pending card is for: approving a new PO, or a cancellation.
      pendingKind: p.status === 'Pending Approval' ? 'approval' : cancelPreview.has(String(p._id)) ? 'cancellation' : null,
      cancelPreview: cancelPreview.get(String(p._id)) || null,
    }));
    res.json({
      purchases: withMode,
      priceJumpWarnPercent: settings.priceJumpWarnPercent ?? DEFAULT_PRICE_JUMP_WARN_PERCENT,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    console.error('Error listing PO approvals:', error);
    res.status(500).json({ message: 'Error loading PO approvals' });
  }
};

// PUT /api/po-approvals/:id/review  body: { decision: 'approve'|'reject', remarks }
export const reviewPOApproval = async (req, res) => {
  try {
    const { decision } = req.body;
    const remarks = String(req.body.remarks || '').trim();
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be approve or reject' });
    }
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: 'Purchase order not found' });
    if (String(purchase.companyId) !== String(req.user.companyId) && req.user.role !== 'Super Admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (purchase.status !== 'Pending Approval') {
      return res.status(409).json({ message: `This PO is already ${purchase.status}.` });
    }
    // Separation of duties — nobody approves a PO they raised themselves.
    if (String(purchase.approval?.requestedBy || purchase.createdBy) === String(req.user._id)) {
      return res.status(403).json({ message: 'You can\'t review a PO you created yourself.' });
    }

    if (decision === 'reject') {
      if (!remarks) return res.status(400).json({ message: 'Give a reason for rejecting.' });
      purchase.status = 'Rejected';
    } else {
      const problem = await checkPurchaseStillValid(purchase);
      if (problem) {
        return res.status(409).json({ message: `Can't approve: ${problem} Reject it so Purchase can redo the PO.` });
      }
    }
    purchase.set('approval.decision', decision === 'approve' ? 'Approved' : 'Rejected');
    purchase.set('approval.reviewedBy', req.user._id);
    purchase.set('approval.reviewedAt', new Date());
    purchase.set('approval.remarks', remarks);
    await purchase.save();
    // Audit log (gap 17) — the decision first, then what finalize does (email).
    await logPoEvent({
      po: purchase, user: req.user, req,
      action: decision === 'approve' ? 'approved' : 'rejected',
      summary: decision === 'approve'
        ? `Approved by the Company Admin${remarks ? ` — "${remarks}"` : ''}.`
        : `Rejected by the Company Admin — "${remarks}". Its items are free on RFQ/PO again.`,
      details: { remarks, approvalReasons: purchase.approval?.reasons || [], grandTotal: purchase.grandTotal },
    });
    if (decision === 'approve') await finalizePurchase(purchase, req.user, req);
    // finalizePurchase emails the PO to the vendor; only a real send moves it to 'Sent'.
    const emailed = purchase.status === 'Sent';

    try {
      await notificationService.createNotification({
        title: `PO ${purchase.purchaseOrderNumber} ${decision === 'approve' ? 'approved' : 'rejected'}`,
        message: decision === 'approve'
          ? `Approved by the Company Admin — it is now an active purchase order${emailed ? ' and has been emailed to the vendor.' : '. The email to the vendor didn\'t go out — use "Send PO email" on Purchase Orders.'}`
          : `Rejected by the Company Admin: ${remarks}`,
        type: 'purchase',
        targetUserId: purchase.approval.requestedBy || purchase.createdBy,
        targetCompanyId: purchase.companyId,
        data: { purchaseId: String(purchase._id) },
      });
    } catch (notifyErr) {
      console.error('Notify requester of PO approval decision failed:', notifyErr);
    }

    res.json({
      message: decision === 'reject' ? 'Rejected — Purchase has been notified.'
        : emailed ? 'Approved — the PO has been emailed to the vendor.'
          : 'Approved — but the PO email to the vendor didn\'t go out; Purchase can resend it from Purchase Orders.',
      purchase,
    });
  } catch (error) {
    console.error('Error reviewing PO approval:', error);
    res.status(500).json({ message: error.message || 'Error reviewing PO' });
  }
};

// GET /api/po-approvals/:id/quote-history — every quotation behind this PO
// (all vendors, all versions), for the Company Admin reviewing it.
export const getPOQuoteHistory = async (req, res) => {
  try {
    const data = await buildQuoteHistory({ companyId: req.user.companyId, purchaseId: req.params.id });
    if (!data) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error loading PO quote history:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
