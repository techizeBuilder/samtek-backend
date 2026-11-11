// Store → Label carriers (serial number work step 2, 2026-10-31 — docs/serial
// number work/serial-tracking-logic-2026-10.md §5.4). A made part / machine
// holding tracked serials went into stock: Store sticks the client's printed
// sticker, enters its number and pairs the serials inside it.
import mongoose from 'mongoose';
import PartLabel from '../models/PartLabel.js';
import { carrierCandidates, labelCarrier, holdsHint, waitingForItem, labelCarriersBulk } from '../services/serialTrailService.js';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/part-labels/groups?status=&search=&page=&limit= — one entry per part.
// Waiting for a sticker is an open-work queue, so it isn't paged; Labelled and
// Not needed only grow, so their entries are paged in the database.
export const listPartLabelGroups = async (req, res) => {
  try {
    const status = ['Unlabelled', 'Labelled', 'Retired', 'Not needed'].includes(req.query.status) ? req.query.status : 'Unlabelled';
    const queue = status === 'Unlabelled';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const companyId = new mongoose.Types.ObjectId(String(req.user.companyId));
    const match = { companyId, status, ...(queue ? { 'place.kind': 'Stock' } : {}) };
    if (req.query.search) {
      const re = new RegExp(escapeRe(req.query.search.trim()), 'i');
      match.$or = [{ itemName: re }, { itemCode: re }, { labelNo: re }, { 'builtIn.orderNo': re }];
    }
    const [result, waiting] = await Promise.all([
      PartLabel.aggregate([
        { $match: match },
        { $group: {
          _id: '$item', itemCode: { $first: '$itemCode' }, itemName: { $first: '$itemName' }, productKind: { $first: '$productKind' },
          count: { $sum: 1 }, inStock: { $sum: { $cond: [{ $eq: ['$place.kind', 'Stock'] }, 1, 0] } },
          orders: { $addToSet: '$builtIn.orderNo' }, oldest: { $min: '$createdAt' }, newest: { $max: '$updatedAt' },
        } },
        { $sort: queue ? { oldest: 1, _id: 1 } : { newest: -1, _id: 1 } },
        { $facet: { rows: queue ? [] : [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'n' }] } },
      ]),
      PartLabel.countDocuments({ companyId, status: 'Unlabelled', 'place.kind': 'Stock' }),
    ]);
    const rows = result[0]?.rows || [];
    const total = result[0]?.total?.[0]?.n || 0;
    res.json({ success: true, data: rows, pagination: queue ? { page: 1, limit: total, total, pages: 1 } : { page, limit, total, pages: Math.ceil(total / limit) }, waiting });
  } catch (err) {
    console.error('Listing part label groups failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/part-labels/waiting/:itemId — the pieces of one part waiting for a
// sticker, what each can hold, and the last sticker used on this part.
export const getWaitingForItem = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.itemId)) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: await waitingForItem(req.user.companyId, req.params.itemId) });
  } catch (err) {
    console.error('Listing waiting pieces failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// POST /api/part-labels/bulk { rows: [{ labelId, labelNo, unitIds, labelIds } | { labelId, nothingInside: true }] }
export const postPartLabelsBulk = async (req, res) => {
  try {
    const out = await labelCarriersBulk({ companyId: req.user.companyId, rows: req.body?.rows, by: req.user.fullName || req.user.username || 'Store' });
    if (out.status) return res.status(out.status).json({ success: false, message: out.message, problems: out.problems });
    res.json({ success: !out.failed.length, saved: out.saved, failed: out.failed, leftover: out.leftover, message: `${out.saved.length} saved${out.failed.length ? `, ${out.failed.length} not saved: ${out.failed.join(' · ')}` : ''}.` });
  } catch (err) {
    console.error('Labelling carriers in bulk failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/part-labels?status=Unlabelled|Labelled&item=&search=&page=&limit=
export const listPartLabels = async (req, res) => {
  try {
    const status = ['Unlabelled', 'Labelled', 'Retired', 'Not needed'].includes(req.query.status) ? req.query.status : 'Unlabelled';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const q = { companyId: req.user.companyId, status };
    if (req.query.item && mongoose.isValidObjectId(req.query.item)) q.item = req.query.item;
    if (req.query.search) {
      const re = new RegExp(escapeRe(req.query.search.trim()), 'i');
      q.$or = [{ itemName: re }, { itemCode: re }, { labelNo: re }, { 'builtIn.orderNo': re }];
    }
    const [rows, total, waiting] = await Promise.all([
      PartLabel.find(q).sort(status === 'Unlabelled' ? { createdAt: 1 } : { labelledAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('contains.units', 'serialNumber itemName vendorName').populate('contains.labels', 'labelNo itemName').lean(),
      PartLabel.countDocuments(q),
      PartLabel.countDocuments({ companyId: req.user.companyId, status: 'Unlabelled', 'place.kind': 'Stock' }),
    ]);
    res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) }, waiting });
  } catch (err) {
    console.error('Listing part labels failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/part-labels/:id/candidates — the serials / stickers it may hold.
export const getLabelCandidates = async (req, res) => {
  try {
    const lab = await PartLabel.findOne({ _id: req.params.id, companyId: req.user.companyId }).lean();
    if (!lab) return res.status(404).json({ success: false, message: 'Not found' });
    const cand = await carrierCandidates(lab.builtIn.order, lab.companyId, { forLabel: lab });
    const ProductionOrder = (await import('../models/ProductionOrder.js')).default;
    const order = await ProductionOrder.findById(lab.builtIn.order).select('orderQuantity company').lean();
    const holdsCount = order ? await holdsHint(order, cand.count) : lab.holdsCount;
    res.json({ success: true, data: { units: cand.units, labels: cand.labels.filter(l => String(l._id) !== String(lab._id)), holdsCount } });
  } catch (err) {
    console.error('Listing label candidates failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// PUT /api/part-labels/:id { labelNo, unitIds, labelIds } or { nothingInside: true }
export const putPartLabel = async (req, res) => {
  try {
    const out = await labelCarrier({
      labelId: req.params.id, companyId: req.user.companyId,
      labelNo: req.body?.labelNo, unitIds: req.body?.unitIds, labelIds: req.body?.labelIds, nothingInside: req.body?.nothingInside,
      by: req.user.fullName || req.user.username || 'Store',
    });
    if (out.status) return res.status(out.status).json({ success: false, message: out.message });
    res.json({ success: true, data: out.label, leftover: out.leftover || [], message: out.label.labelNo ? `Sticker ${out.label.labelNo} saved on ${out.label.itemName}.` : `${out.label.itemName}: nothing tracked inside, no sticker needed.` });
  } catch (err) {
    console.error('Labelling a carrier failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
