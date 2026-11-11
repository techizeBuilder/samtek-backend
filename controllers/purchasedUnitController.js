// Serial numbers of what Store received from vendors (2026-10-13 —
// services/purchasedUnitService.js). Read only.
import QCJob from '../models/QCJob.js';
import PurchasedUnit from '../models/PurchasedUnit.js';
import { listUnits } from '../services/purchasedUnitService.js';
import mongoose from 'mongoose';
import { Item } from '../models/Inventory.js';
import PartLabel from '../models/PartLabel.js';
import { stockTracked, unlabelledInStock, untrackedCount, insideCandidates, defectiveTracked, scpPieceSerials } from '../services/serialTrailService.js';
import ProductionOrder from '../models/ProductionOrder.js';
import SubChildPartJobWorkOrder from '../models/SubChildPartJobWorkOrder.js';
import SerialSkipLog from '../models/SerialSkipLog.js';

// GET /api/serial-numbers/skips?search=&page=&limit= — went ahead with fewer
// serials than pieces (logic §12).
export const getSerialSkips = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const q = { companyId: req.user.companyId };
    const search = String(req.query.search || '').trim();
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [{ itemName: re }, { screen: re }, { reference: re }, { byName: re }];
    }
    const [rows, total] = await Promise.all([
      SerialSkipLog.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SerialSkipLog.countDocuments(q),
    ]);
    res.json({ success: true, rows, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Serial number work step 2 (2026-10-31): what the pickers show.
const oidOk = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
async function itemFor(companyId, { itemId, itemCode }) {
  if (oidOk(itemId)) return Item.findOne({ _id: itemId, companyId }).select('name code unit qty productKind productionUse').lean();
  if (itemCode) return Item.findOne({ code: String(itemCode), companyId }).select('name code unit qty productKind productionUse').lean();
  return null;
}

// GET /api/serial-numbers/stock?itemCode=|itemId= — the serials / stickers of an
// item in Store's stock (Store's transfer / Dispatch handover / QC picker),
// with the numbers the pick rule uses.
export const getStockPicks = async (req, res) => {
  try {
    const item = await itemFor(req.user.companyId, req.query);
    if (!item) return res.json({ success: true, data: { tracked: 0, untracked: 0, units: [], labels: [], unlabelled: 0 } });
    const t = await stockTracked(req.user.companyId, item._id);
    const unlabelled = await unlabelledInStock(req.user.companyId, item._id);
    res.json({ success: true, data: {
      // A part or product is always built in: R&D's usage choice doesn't apply to it.
      item: { _id: item._id, name: item.name, code: item.code, unit: item.unit, productionUse: item.productionUse || (item.productKind ? 'BuiltIn' : null) },
      units: t.units, labels: t.labels, tracked: t.count, stock: item.qty || 0, untracked: untrackedCount(item.qty, t.count, unlabelled), unlabelled,
    } });
  } catch (err) {
    console.error('Listing stock serials failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/serial-numbers/issued?orderId=&itemCode=|itemId= — what was issued to
// a production order of an item and is still with it (Production's return).
export const getIssuedPicks = async (req, res) => {
  try {
    if (!oidOk(req.query.orderId)) return res.status(400).json({ success: false, message: 'Pass orderId' });
    const item = await itemFor(req.user.companyId, req.query);
    if (!item) return res.json({ success: true, data: { units: [], labels: [] } });
    const order = new mongoose.Types.ObjectId(req.query.orderId);
    const [units, labels] = await Promise.all([
      PurchasedUnit.find({ companyId: req.user.companyId, item: item._id, 'place.kind': { $in: ['Issued', 'Used'] }, 'place.order': order }).select('serialNumber vendorName place').sort({ serialKey: 1 }).lean(),
      PartLabel.find({ companyId: req.user.companyId, item: item._id, 'place.kind': 'Issued', 'place.order': order }).select('labelNo place').sort({ labelKey: 1 }).lean(),
    ]);
    res.json({ success: true, data: { item: { _id: item._id, name: item.name, code: item.code }, units, labels } });
  } catch (err) {
    console.error('Listing issued serials failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/serial-numbers/inside?orderId=&itemCode= — what's built into a cascade
// part this order received (Production's return of a part with no sticker).
export const getInsidePicks = async (req, res) => {
  try {
    if (!oidOk(req.query.orderId) || !req.query.itemCode) return res.status(400).json({ success: false, message: 'Pass orderId and itemCode' });
    const c = await insideCandidates(req.query.orderId, String(req.query.itemCode), req.user.companyId);
    res.json({ success: true, data: { units: c.units, labels: c.labels } });
  } catch (err) {
    console.error('Listing serials inside a part failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/serial-numbers/scp-pieces?jobId=|orderId= — the source serials of a Sub
// Child Part order (its QC job, or the order itself), for pieces scrapped by QC
// or lost at a vendor.
export const getScpPiecePicks = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    let order = null;
    if (oidOk(req.query.jobId)) {
      const job = await QCJob.findOne({ _id: req.query.jobId, company: companyId }).select('sourceRefId subChildPartJobWorkOrderId').lean();
      order = job?.subChildPartJobWorkOrderId
        ? await SubChildPartJobWorkOrder.findOne({ _id: job.subChildPartJobWorkOrderId, company: companyId }).select('subChildPartItem').lean()
        : job?.sourceRefId ? await ProductionOrder.findOne({ orderId: job.sourceRefId, company: companyId }).select('subChildPartItem').lean() : null;
    } else if (oidOk(req.query.orderId)) {
      order = await ProductionOrder.findOne({ _id: req.query.orderId, company: companyId }).select('subChildPartItem').lean()
        || await SubChildPartJobWorkOrder.findOne({ _id: req.query.orderId, company: companyId }).select('subChildPartItem').lean();
    }
    if (!order?.subChildPartItem) return res.json({ success: true, data: { units: [], labels: [], perPiece: 0 } });
    const s = await scpPieceSerials(companyId, order._id, order.subChildPartItem);
    res.json({ success: true, data: { units: s.units, labels: [], perPiece: s.perPiece } });
  } catch (err) {
    console.error('Listing a Sub Child Part order\'s serials failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/serial-numbers/defective?itemCode= — what's tracked under a Defective
// Inventory row (itemCode = its material code).
export const getDefectivePicks = async (req, res) => {
  try {
    if (!req.query.itemCode) return res.status(400).json({ success: false, message: 'Pass itemCode' });
    const t = await defectiveTracked(req.user.companyId, String(req.query.itemCode));
    res.json({ success: true, data: { units: t.units, labels: t.labels } });
  } catch (err) {
    console.error('Listing defective serials failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/serial-numbers?search=&status=&kind=serial|lot&page=&limit=
export const getSerialNumbers = async (req, res) => {
  try {
    const { search, status, kind, page, limit } = req.query;
    const data = await listUnits({ companyId: req.user.companyId, search, status, kind, page, limit });
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Listing serial numbers failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// GET /api/serial-numbers/qc-job/:id — the serials of one QC job (empty for
// a lot / anything not bought on a PO), for QC to tick the rejected ones.
export const getQcJobSerials = async (req, res) => {
  try {
    const job = await QCJob.findOne({ _id: req.params.id, company: req.user.companyId }).select('source purchaseRequestId receiptKey company').lean();
    if (!job) return res.status(404).json({ success: false, message: 'QC job not found' });
    if (job.source !== 'Purchase' || !job.purchaseRequestId) return res.json({ success: true, data: [] });
    // QC by PO line (2026-10-15): the serials of every request on the received line.
    const prIds = job.receiptKey
      ? (await QCJob.find({ company: job.company, receiptKey: job.receiptKey }).select('purchaseRequestId').lean()).map(j => j.purchaseRequestId).filter(Boolean)
      : [job.purchaseRequestId];
    const rows = await PurchasedUnit.find({ companyId: req.user.companyId, purchaseRequest: { $in: prIds } })
      .sort({ _id: 1 }).select('serialNumber isLot lotQty qtyUnit status rejectedQty acceptedQty warrantyCardUrl').lean();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Listing a QC job\'s serial numbers failed:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
