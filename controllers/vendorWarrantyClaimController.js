// Vendor warranty claims — Complaints → Support (2026-10-13,
// services/vendorWarrantyClaimService.js).
import mongoose from 'mongoose';
import { lookupSerial, createClaim, updateClaim, listClaims } from '../services/vendorWarrantyClaimService.js';

const fail = (res, err, what) => {
  console.error(`${what} failed:`, err);
  res.status(500).json({ success: false, message: 'Server Error' });
};

// GET /api/vendor-warranty-claims?status=&search=&vendorId=&page=
export const getClaims = async (req, res) => {
  try {
    const { status, search, vendorId, page, limit } = req.query;
    res.json({ success: true, ...(await listClaims({ companyId: req.user.companyId, status, search, vendorId, page, limit })) });
  } catch (err) { fail(res, err, 'Listing warranty claims'); }
};

// GET /api/vendor-warranty-claims/:id
export const getClaim = async (req, res) => {
  try {
    const { default: VendorWarrantyClaim } = await import('../models/VendorWarrantyClaim.js');
    const claim = mongoose.isValidObjectId(req.params.id)
      ? await VendorWarrantyClaim.findOne({ _id: req.params.id, companyId: req.user.companyId }).lean()
      : null;
    if (!claim) return res.status(404).json({ success: false, message: 'Claim not found.' });
    res.json({ success: true, data: claim });
  } catch (err) { fail(res, err, 'Reading a warranty claim'); }
};

// GET /api/vendor-warranty-claims/lookup?serial=
export const lookupClaimSerial = async (req, res) => {
  try {
    res.json({ success: true, data: await lookupSerial(req.user.companyId, req.query.serial) });
  } catch (err) { fail(res, err, 'Looking up a serial'); }
};

// GET /api/vendor-warranty-claims/vendors — for picking the vendor by hand.
export const getClaimVendors = async (req, res) => {
  try {
    const rows = await mongoose.model('Supplier').find({ companyId: req.user.companyId }).select('supplierName').sort({ supplierName: 1 }).lean();
    res.json({ success: true, data: rows.map(v => ({ _id: v._id, name: v.supplierName })) });
  } catch (err) { fail(res, err, 'Listing vendors for a claim'); }
};

// GET /api/vendor-warranty-claims/items?search= — for picking the item by hand.
export const getClaimItems = async (req, res) => {
  try {
    const { Item } = await import('../models/Inventory.js');
    const s = String(req.query.search || '').trim();
    const q = { companyId: req.user.companyId };
    if (s) {
      const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [{ name: re }, { code: re }];
    }
    const rows = await Item.find(q).select('name code warranty.period').sort({ name: 1 }).limit(30).lean();
    res.json({ success: true, data: rows.map(i => ({ _id: i._id, name: i.name, code: i.code, warrantyMonths: Number(i.warranty?.period) || 0 })) });
  } catch (err) { fail(res, err, 'Listing items for a claim'); }
};

// POST /api/vendor-warranty-claims (multipart, evidence[])
export const postClaim = async (req, res) => {
  try {
    const r = await createClaim({ companyId: req.user.companyId, user: req.user, body: req.body, files: req.files || [] });
    if (r.status) return res.status(r.status).json({ success: false, message: r.message });
    res.status(201).json({ success: true, data: r.claim, message: `${r.claim.number} raised.` });
  } catch (err) { fail(res, err, 'Raising a warranty claim'); }
};

// PUT /api/vendor-warranty-claims/:id (multipart, evidence[])
export const putClaim = async (req, res) => {
  try {
    const r = await updateClaim({ id: req.params.id, companyId: req.user.companyId, user: req.user, body: req.body, files: req.files || [] });
    if (r.status) return res.status(r.status).json({ success: false, message: r.message });
    res.json({ success: true, data: r.claim, message: r.claim.status === 'Closed' ? `${r.claim.number} closed.` : `${r.claim.number} updated.` });
  } catch (err) { fail(res, err, 'Updating a warranty claim'); }
};
