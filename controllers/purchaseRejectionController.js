// QC rejections of purchased material + money the vendor holds of ours
// (procurement-v2, accounts Slice 3, 2026-10-12). Thin handlers over
// services/purchaseRejectionService.js. Routes: routes/accountsRoutes.js
// (/api/accounts/purchases/rejections, /api/accounts/purchases/money-back).
import mongoose from 'mongoose';
import PurchaseRejection from '../models/PurchaseRejection.js';
import VendorMoneyBack from '../models/VendorMoneyBack.js';
import { recordAnswer, recordRefundReceived, decideMoneyBack, vendorCreditAvailable, OPEN_REJECTION_STATUSES } from '../services/purchaseRejectionService.js';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET ?view=open|done|all &purchaseOrder= &search= &page= &limit=
export const listRejections = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const { view = 'open', purchaseOrder, search } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const query = { companyId };
    if (view === 'open') query.status = { $in: OPEN_REJECTION_STATUSES };
    else if (view === 'done') query.status = { $nin: OPEN_REJECTION_STATUSES };
    if (purchaseOrder && mongoose.isValidObjectId(purchaseOrder)) query.purchaseOrder = purchaseOrder;
    if (search) {
      const re = new RegExp(escapeRe(search.trim()), 'i');
      query.$or = [{ number: re }, { poNumber: re }, { vendorName: re }, { itemName: re }];
    }
    const [rows, total, open, awaiting] = await Promise.all([
      PurchaseRejection.find(query)
        .populate('replacement.purchaseRequest', 'requestId status receivedAt')
        .populate('moneyBack', 'amount status mode used refund')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PurchaseRejection.countDocuments(query),
      PurchaseRejection.countDocuments({ companyId, status: { $in: OPEN_REJECTION_STATUSES } }),
      PurchaseRejection.countDocuments({ companyId, status: 'Awaiting vendor answer' }),
    ]);
    res.json({ success: true, data: { rejections: rows, counts: { open, awaiting }, pagination: { total, page, limit, pages: Math.ceil(total / limit) } } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /:id/answer { outcome: replace|refused|refund|credit, expectedDate?, note? }
export const answerRejection = async (req, res) => {
  try {
    const result = await recordAnswer({ rejectionId: req.params.id, body: req.body, user: req.user, req });
    if (result.status) return res.status(result.status).json({ success: false, message: result.message });
    res.json({ success: true, data: result.rejection, message: `${result.rejection.number}: answer recorded.` });
  } catch (error) {
    console.error('answerRejection error:', error);
    res.status(500).json({ success: false, message: 'Could not record the vendor\'s answer.' });
  }
};

// GET ?status= &vendorId= — refunds due, credits, cancellation leftovers to decide.
export const listMoneyBack = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const query = { companyId };
    if (req.query.status && req.query.status !== 'All') query.status = req.query.status;
    if (req.query.vendorId && mongoose.isValidObjectId(req.query.vendorId)) query.vendor = req.query.vendorId;
    const rows = await VendorMoneyBack.find(query)
      .populate('rejection', 'number itemName rejectedQty qtyUnit')
      .populate('refund.account', 'accountName')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const credit = req.query.vendorId && mongoose.isValidObjectId(req.query.vendorId)
      ? await vendorCreditAvailable(companyId, req.query.vendorId) : null;
    res.json({ success: true, data: { items: rows, vendorCredit: credit } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /money-back/:id/refund { accountId, receivedAt?, reference? }
export const refundReceived = async (req, res) => {
  try {
    const result = await recordRefundReceived({ id: req.params.id, body: req.body, user: req.user, req });
    if (result.status) return res.status(result.status).json({ success: false, message: result.message });
    res.json({ success: true, data: result.moneyBack, message: 'Refund recorded.' });
  } catch (error) {
    console.error('refundReceived error:', error);
    res.status(500).json({ success: false, message: 'Could not record the refund.' });
  }
};

// PUT /money-back/:id/decide { mode: Refund|Credit, note? }
export const decideLeftover = async (req, res) => {
  try {
    const result = await decideMoneyBack({ id: req.params.id, body: req.body, user: req.user, req });
    if (result.status) return res.status(result.status).json({ success: false, message: result.message });
    res.json({ success: true, data: result.moneyBack, message: result.moneyBack.mode === 'Refund' ? 'Marked: the vendor refunds it.' : 'Kept as vendor credit.' });
  } catch (error) {
    console.error('decideLeftover error:', error);
    res.status(500).json({ success: false, message: 'Could not save the decision.' });
  }
};
