// Serial numbers of what Store received from vendors (2026-10-13 —
// services/purchasedUnitService.js). Read only.
import QCJob from '../models/QCJob.js';
import PurchasedUnit from '../models/PurchasedUnit.js';
import { listUnits } from '../services/purchasedUnitService.js';

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
