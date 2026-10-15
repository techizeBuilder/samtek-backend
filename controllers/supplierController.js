import { checkGstin, cleanGstin, stateFromText } from '../services/gstStateService.js';
import mongoose from 'mongoose';
import Supplier from '../models/Supplier.js';
import { Item } from '../models/Inventory.js';
import ProcessCategoryOption from '../models/ProcessCategoryOption.js';
import ChildPartBOM from '../models/ChildPartBOM.js';
import MachineBOM from '../models/MachineBOM.js';
import * as XLSX from 'xlsx';
import multer from 'multer';
import { computeVendorScores, computeVendorItemPricing, scoreSettingsOf } from '../services/vendorScoreService.js';
import { getOrCreateSettings } from './purchaseSettingsController.js';
import Purchase from '../models/Purchase.js';
import VendorApprovalRequest from '../models/VendorApprovalRequest.js';
import { removeVendorUpload, discardRequestUploads } from '../middleware/vendorDocumentUpload.js';
import {
  ELIGIBLE_VENDOR_FILTER, SENSITIVE_FIELDS, SENSITIVE_LABELS, stripServerControlled,
  diffSensitiveFields, validateForSubmission, getVendorStanding, activityEntry,
  notifyCompanyAdminOfRequest,
} from '../services/vendorApprovalService.js';

// suppliedItems/services arrive straight from the Vendor Master form — keep
// only valid Item ids and trimmed, non-empty, de-duplicated (case-
// insensitive) step names. Absent/non-array means "not being edited" and is
// left out, so other callers saving a vendor never wipe them.
function cleanVendorCoverage(body) {
  if (Array.isArray(body.suppliedItems)) {
    body.suppliedItems = [...new Set(body.suppliedItems.map(String).filter(id => mongoose.Types.ObjectId.isValid(id)))];
  } else {
    delete body.suppliedItems;
  }
  if (Array.isArray(body.services)) {
    const seen = new Set();
    body.services = body.services.map(s => String(s).trim()).filter(s => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else {
    delete body.services;
  }
  // The vendor-level commercial fields were removed (procurement-v2) —
  // charges, payment terms and GST are entered on the PO. Never accept them.
  for (const key of ['charges', 'paymentAdvancePercent', 'paymentBalancePercent', 'creditDays', 'paymentNotes', 'gstRate']) {
    delete body[key];
  }
}

// GET /api/suppliers/catalog — what the Vendor Master's Product / Services
// tabs pick from (2026-09-25).
//  - items: every Purchasable Item of the company (Inventory, Product
//    Master, Motor Master). Child Parts / Sub Child Parts are excluded by
//    kind, not just by flag: the BOM creates them in-house, and their vendor
//    need is outsourced job work — the Services tab.
//  - services: Process Template step names (every BOM level, de-duplicated
//    by name, since matching is by name across levels), each with where it
//    sits in the templates and which parts' BOMs actually use it as an Out
//    Source step. Templates don't record In-House/Out Source — each BOM step
//    does — so usedBy is what tells Purchase a step is really outsourced.
//    Out Source step names found in a BOM but no longer in the templates
//    (e.g. renamed since) are listed too, so they can still be covered.
export const getSupplierCatalog = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const notDiscontinued = { isDiscontinued: { $ne: true } };

    const items = await Item.find({
      companyId, purchase: true, ...notDiscontinued,
      productKind: { $nin: ['SubChildPart', 'ChildPart'] },
    }).select('code name productKind category subCategory itemCategories unit').sort({ name: 1 }).lean();
    const sourceOf = (it) => it.productKind === 'Machine' ? 'Product Master' : it.productKind === 'Motor' ? 'Motor Master' : 'Inventory';

    const byName = new Map();
    const entryFor = (name) => {
      const key = name.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, { name: name.trim(), templates: [], usedBy: [] });
      return byName.get(key);
    };

    const templates = await ProcessCategoryOption.find({ companyId }).lean();
    for (const t of templates) {
      for (const step of t.internalProcesses || []) {
        if (step?.trim()) entryFor(step).templates.push({ bomLevel: t.bomLevel, category: t.label });
      }
    }

    const addUsage = (bomLevel, part, processDefinition) => {
      if (!part) return;
      for (const cat of processDefinition || []) {
        for (const step of cat.internalProcesses || []) {
          if (step.type !== 'OutSource' || !step.name?.trim()) continue;
          const entry = entryFor(step.name);
          if (!entry.usedBy.some(u => String(u._id) === String(part._id))) {
            entry.usedBy.push({ _id: part._id, code: part.code, name: part.name, bomLevel });
          }
        }
      }
    };
    const [subChildParts, childPartBoms, machineBoms] = await Promise.all([
      Item.find({ companyId, productKind: 'SubChildPart', ...notDiscontinued }).select('code name subChildPartDetails.processDefinition').lean(),
      ChildPartBOM.find({ company: companyId }).select('childPart processDefinition').populate('childPart', 'code name isDiscontinued').lean(),
      MachineBOM.find({ company: companyId }).select('machine processDefinition').populate('machine', 'code name isDiscontinued').lean(),
    ]);
    subChildParts.forEach(p => addUsage('SubChildPart', p, p.subChildPartDetails?.processDefinition));
    childPartBoms.forEach(b => { if (!b.childPart?.isDiscontinued) addUsage('ChildPart', b.childPart, b.processDefinition); });
    machineBoms.forEach(b => { if (!b.machine?.isDiscontinued) addUsage('Machine', b.machine, b.processDefinition); });

    res.json({
      success: true,
      items: items.map(it => ({ ...it, source: sourceOf(it) })),
      services: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    console.error('Error building supplier catalog:', error);
    res.status(500).json({ message: 'Error loading vendor catalog' });
  }
};

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
    }
  }
});

export const getSuppliers = async (req, res) => {
  try {
    const unit = req.user.unit;
    const { page, limit, search, supplierType, approvalStatus, eligible, withStanding } = req.query;
    const query = { companyId: req.user.companyId, unit: { $in: [unit, 'Main'] } };
    if (supplierType) query.supplierType = supplierType;
    // Vendor Master v2 (procurement-v2): Vendor Master's status chips filter
    // by approvalStatus; quoting/ordering screens (By Vendor) ask for
    // eligible=true so a Draft/Pending/Suspended/Blacklisted/Inactive vendor
    // is never offered. Pickers for invoices/payments pass neither and keep
    // seeing every vendor — money owed to a suspended vendor still gets paid.
    if (approvalStatus) query.approvalStatus = { $in: String(approvalStatus).split(',') };
    if (eligible === 'true') Object.assign(query, ELIGIBLE_VENDOR_FILTER);
    if (search) {
      query.$or = [
        { supplierName: { $regex: search, $options: 'i' } },
        { supplierCode: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    // Vendor-picker dropdowns (PurchaseInvoices, VendorPayments, etc.) call
    // this with no page/limit and need the full list — only paginate when a
    // caller (Vendor Master's own browse page) actually asks for a page.
    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const [suppliers, total] = await Promise.all([
        Supplier.find(query).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
        Supplier.countDocuments(query),
      ]);
      // Vendor Master's own page only — the derived stage (Probationary/
      // Active/Watchlist) and any change waiting for the Company Admin. Not
      // computed for pickers: the rating lookup is per vendor.
      let rows = suppliers;
      if (withStanding === 'true' && suppliers.length) {
        const ids = suppliers.map(s => s._id);
        const [standing, pending] = await Promise.all([
          getVendorStanding(req.user.companyId, suppliers),
          VendorApprovalRequest.find({ vendor: { $in: ids }, status: 'Pending' })
            .select('vendor type payload previousValue requestedAt').lean(),
        ]);
        rows = suppliers.map(s => ({
          ...s.toObject(),
          standing: standing.get(String(s._id)) || { stage: s.approvalStatus },
          pendingRequests: pending.filter(p => String(p.vendor) === String(s._id)),
        }));
      }
      return res.json({
        suppliers: rows,
        pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
      });
    }

    const suppliers = await Supplier.find(query).sort({ createdAt: -1 });
    res.json({ suppliers });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ message: 'Error fetching suppliers' });
  }
};

export const getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    res.json(supplier);
  } catch (error) {
    console.error('Error fetching supplier:', error);
    res.status(500).json({ message: 'Error fetching supplier' });
  }
};

// Point 15 (2026-10-10): the GSTIN decides CGST + SGST vs IGST on POs, so
// it must be well-formed (blank = not GST-registered); address states are
// stored by their proper name (a typed '09' or 'UP' becomes 'Uttar Pradesh').
// Returns an error message, or null.
function cleanVendorGst(body) {
  if (body.gstNumber !== undefined) {
    body.gstNumber = cleanGstin(body.gstNumber);
    const { error } = checkGstin(body.gstNumber);
    if (error) return error;
  }
  for (const key of ['address', 'billingAddress', 'dispatchAddress']) {
    const st = body[key]?.state;
    if (st) body[key].state = stateFromText(st)?.name || st;
  }
  return null;
}

export const createSupplier = async (req, res) => {
  try {
    // Approval fields, documents and history are server-controlled — a new
    // vendor always starts as a Draft (Vendor Master v2, procurement-v2).
    const supplierData = stripServerControlled({ ...req.body });
    supplierData.unit = req.user.unit;
    supplierData.companyId = req.user.companyId;
    // Vendor-creation split (2026-10): Products/Services are assigned later,
    // via a separate edit — never as part of creating the vendor. The form
    // no longer sends these on create, but createSupplier has no field
    // whitelist otherwise, so strip them explicitly rather than trust that.
    delete supplierData.suppliedItems;
    delete supplierData.services;
    cleanVendorCoverage(supplierData);
    const gstProblem = cleanVendorGst(supplierData);
    if (gstProblem) return res.status(400).json({ message: gstProblem });
    supplierData.approvalStatus = 'Draft';
    supplierData.createdBy = req.user._id;
    supplierData.updatedBy = req.user._id;
    supplierData.activity = [activityEntry('Created', req.user)];
    const supplier = new Supplier(supplierData);
    await supplier.save();
    res.status(201).json({ message: 'Supplier created successfully', supplier });
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(error.name === 'ValidationError' ? 400 : 500).json({
      message: error.message || 'Error creating supplier',
      errors: error.errors
    });
  }
};

const APPROVED_LIKE = ['Approved', 'Suspended', 'Blacklisted'];

export const updateSupplier = async (req, res) => {
  try {
    const vendor = await Supplier.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!vendor) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    // Under review — the Company Admin must approve exactly what was
    // submitted, so editing is closed until Purchase withdraws it.
    if (vendor.approvalStatus === 'Pending Approval') {
      return res.status(409).json({ message: 'This vendor is waiting for Company Admin approval — withdraw the submission to edit it.' });
    }
    cleanVendorCoverage(req.body);
    const gstProblem = cleanVendorGst(req.body);
    if (gstProblem) return res.status(400).json({ message: gstProblem });
    // companyId (and every approval/document/history field) is never
    // editable from this form — see stripServerControlled.
    stripServerControlled(req.body);

    // On an approved (or suspended/blacklisted) vendor, legal name / GSTIN /
    // PAN / bank details don't change straight away: the change goes to the
    // Company Admin as one DetailsChange request and the old values stay
    // live until it's approved. A second edit merges into the same pending
    // request; editing a field back to its live value drops it from the
    // request, and an emptied request is cancelled.
    // Contract with the form: a sensitive field that IS sent means "this is
    // the value I want". So while a change is pending, VendorMaster.jsx
    // pre-fills those inputs with the PROPOSED values — otherwise saving an
    // unrelated field would resend the live values and cancel the request.
    let sentForApproval = [];
    if (APPROVED_LIKE.includes(vendor.approvalStatus)) {
      const { changes, previous } = diffSensitiveFields(vendor, req.body);
      const touched = SENSITIVE_FIELDS.filter(f => f in req.body);
      for (const field of SENSITIVE_FIELDS) delete req.body[field];

      let request = await VendorApprovalRequest.findOne({ vendor: vendor._id, type: 'DetailsChange', status: 'Pending' });
      if (request) {
        const payload = { ...(request.payload || {}) };
        for (const field of touched) {
          if (field in changes) payload[field] = changes[field];
          else delete payload[field];
        }
        if (Object.keys(payload).length === 0) {
          request.status = 'Cancelled';
        } else {
          request.payload = payload;
          request.previousValue = { ...previous, ...(request.previousValue || {}) };
          request.requestedBy = req.user._id;
          request.requestedAt = new Date();
          request.markModified('payload');
          request.markModified('previousValue');
        }
        await request.save();
        if (request.status === 'Pending') sentForApproval = Object.keys(payload);
      } else if (Object.keys(changes).length) {
        request = await VendorApprovalRequest.create({
          companyId: vendor.companyId,
          vendor: vendor._id,
          type: 'DetailsChange',
          payload: changes,
          previousValue: previous,
          requestedBy: req.user._id,
        });
        sentForApproval = Object.keys(changes);
      }
      if (request?.status === 'Pending' && Object.keys(changes).length) {
        await notifyCompanyAdminOfRequest(request, vendor, req.user);
      }
    }

    const sentLabels = sentForApproval.map(f => SENSITIVE_LABELS[f] || f);
    // Step 2 of vendor creation (D2) saves only Products & Services from its
    // own dialog — label that in the history instead of a generic "Edited".
    const bodyKeys = Object.keys(req.body);
    const coverageOnly = bodyKeys.length > 0 && bodyKeys.every(k => k === 'suppliedItems' || k === 'services');
    req.body.updatedBy = req.user._id;
    const supplier = await Supplier.findOneAndUpdate(
      { _id: req.params.id, companyId: req.user.companyId },
      {
        $set: req.body,
        $push: {
          activity: activityEntry(
            sentLabels.length ? `Edited — sent for approval: ${sentLabels.join(', ')}`
              : coverageOnly ? 'Products & Services updated' : 'Edited',
            req.user
          ),
        },
      },
      { new: true, runValidators: true }
    );
    res.json({
      message: sentLabels.length
        ? `Saved. ${sentLabels.join(', ')} change sent to the Company Admin for approval — the current values stay until it's approved.`
        : 'Supplier updated successfully',
      supplier,
      sentForApproval: sentLabels,
    });
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(error.name === 'ValidationError' ? 400 : 500).json({ message: error.message || 'Error updating supplier' });
  }
};

// Only a vendor that was never approved (Draft/Rejected) and has no PO can
// be deleted — an approved vendor carries history, so it's suspended or
// blacklisted instead (procurement-v2).
export const deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    if (!['Draft', 'Rejected'].includes(supplier.approvalStatus)) {
      return res.status(409).json({ message: 'Only Draft or Rejected vendors can be deleted — suspend or blacklist an approved vendor instead.' });
    }
    if (await Purchase.exists({ supplier: supplier._id, companyId: req.user.companyId })) {
      return res.status(409).json({ message: 'This vendor already has purchase orders and can\'t be deleted.' });
    }
    // Its uploaded files go with it — document files and any request
    // evidence — so nothing is left on disk that no record points at.
    const requests = await VendorApprovalRequest.find({ vendor: supplier._id }).select('evidence').lean();
    const fileUrls = [
      ...(supplier.documents || []).map(d => d.fileUrl),
      ...requests.flatMap(r => (r.evidence || []).map(e => e.fileUrl)),
    ];
    await VendorApprovalRequest.deleteMany({ vendor: supplier._id });
    await supplier.deleteOne();
    await Promise.all(fileUrls.map(removeVendorUpload));
    res.json({ message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({ message: 'Error deleting supplier' });
  }
};

// ── Vendor Master v2 — approval lifecycle (procurement-v2, 2026-10-08) ───────

// POST /api/suppliers/:id/submit — Draft/Rejected → Pending Approval. Returns
// 400 with `missing` (plain sentences) when the vendor isn't complete yet.
export const submitForApproval = async (req, res) => {
  try {
    const vendor = await Supplier.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!vendor) return res.status(404).json({ message: 'Supplier not found' });
    if (!['Draft', 'Rejected'].includes(vendor.approvalStatus)) {
      return res.status(409).json({ message: `This vendor is already ${vendor.approvalStatus}.` });
    }
    const missing = validateForSubmission(vendor);
    if (missing.length) {
      return res.status(400).json({ message: 'Complete these before submitting for approval.', missing });
    }
    const request = await VendorApprovalRequest.create({
      companyId: vendor.companyId,
      vendor: vendor._id,
      type: 'NewVendor',
      requestedBy: req.user._id,
    });
    vendor.approvalStatus = 'Pending Approval';
    vendor.updatedBy = req.user._id;
    vendor.activity.push(activityEntry('Submitted for approval', req.user));
    await vendor.save();
    await notifyCompanyAdminOfRequest(request, vendor, req.user);
    res.json({ message: 'Sent to the Company Admin for approval.', supplier: vendor });
  } catch (error) {
    console.error('Error submitting vendor for approval:', error);
    res.status(500).json({ message: 'Error submitting vendor for approval' });
  }
};

// POST /api/suppliers/:id/withdraw — Pending Approval → Draft, so Purchase
// can edit again.
export const withdrawApproval = async (req, res) => {
  try {
    const vendor = await Supplier.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!vendor) return res.status(404).json({ message: 'Supplier not found' });
    if (vendor.approvalStatus !== 'Pending Approval') {
      return res.status(409).json({ message: 'This vendor is not waiting for approval.' });
    }
    await VendorApprovalRequest.updateMany(
      { vendor: vendor._id, type: 'NewVendor', status: 'Pending' },
      { status: 'Cancelled' }
    );
    vendor.approvalStatus = 'Draft';
    vendor.updatedBy = req.user._id;
    vendor.activity.push(activityEntry('Submission withdrawn', req.user));
    await vendor.save();
    res.json({ message: 'Submission withdrawn — the vendor is a Draft again.', supplier: vendor });
  } catch (error) {
    console.error('Error withdrawing vendor submission:', error);
    res.status(500).json({ message: 'Error withdrawing submission' });
  }
};

const DOC_TYPES = Supplier.schema.path('documents').schema.path('docType').enumValues;

// POST /api/suppliers/:id/documents — multipart: file, docType, docNumber,
// expiryDate. Closed while the vendor is under review (same rule as editing).
// The file is already on disk by the time this runs (multer), so every
// refusal/failure below discards it — no orphaned files.
export const uploadVendorDocument = async (req, res) => {
  const fail = async (status, message) => {
    await discardRequestUploads(req);
    return res.status(status).json({ message });
  };
  try {
    const vendor = await Supplier.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!vendor) return fail(404, 'Supplier not found');
    if (vendor.approvalStatus === 'Pending Approval') {
      return fail(409, 'This vendor is waiting for Company Admin approval — withdraw the submission to change its documents.');
    }
    if (!req.file) return fail(400, 'Choose a file to upload.');
    const { docType, docNumber, expiryDate } = req.body;
    if (!DOC_TYPES.includes(docType)) return fail(400, 'Choose a valid document type.');
    // A date-only value ('YYYY-MM-DD'), stored as that day's UTC midnight;
    // the UI compares it by day, so a document is valid through its date.
    const expiry = expiryDate ? new Date(expiryDate) : null;
    if (expiry && isNaN(expiry.getTime())) return fail(400, 'Invalid expiry date.');

    vendor.documents.push({
      docType,
      docNumber: docNumber || '',
      fileUrl: `/uploads/vendor-documents/${req.file.filename}`,
      fileName: req.file.originalname,
      expiryDate: expiry,
      uploadedBy: req.user._id,
    });
    vendor.updatedBy = req.user._id;
    vendor.activity.push(activityEntry(`Document added: ${docType}`, req.user));
    await vendor.save();
    res.status(201).json({ message: 'Document uploaded', supplier: vendor });
  } catch (error) {
    console.error('Error uploading vendor document:', error);
    await discardRequestUploads(req);
    res.status(500).json({ message: error.message || 'Error uploading document' });
  }
};

// DELETE /api/suppliers/:id/documents/:docId — removes the record AND its
// file on disk (after the record is gone, so a failed save never leaves a
// record pointing at a deleted file).
export const deleteVendorDocument = async (req, res) => {
  try {
    const vendor = await Supplier.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!vendor) return res.status(404).json({ message: 'Supplier not found' });
    if (vendor.approvalStatus === 'Pending Approval') {
      return res.status(409).json({ message: 'This vendor is waiting for Company Admin approval — withdraw the submission to change its documents.' });
    }
    const doc = vendor.documents.id(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    const { docType, fileUrl } = doc;
    doc.deleteOne();
    vendor.updatedBy = req.user._id;
    vendor.activity.push(activityEntry(`Document removed: ${docType}`, req.user));
    await vendor.save();
    await removeVendorUpload(fileUrl);
    res.json({ message: 'Document removed', supplier: vendor });
  } catch (error) {
    console.error('Error deleting vendor document:', error);
    res.status(500).json({ message: 'Error removing document' });
  }
};

// POST /api/suppliers/:id/status-requests — multipart: type
// (Suspend|Blacklist|Reinstate), reason, reviewDate, evidence files.
// Suspend/Blacklist need an approved vendor, a reason and at least one
// evidence file (blueprint §25); Reinstate needs a suspended/blacklisted
// vendor and a reason. Nothing changes until the Company Admin approves.
// Evidence files are already on disk when this runs (multer) — every refusal
// or failure discards them, so a rejected request leaves no orphaned files.
// (Evidence of a request that WAS created stays with it even if it's later
// rejected — it's part of that request's record.)
export const requestStatusChange = async (req, res) => {
  const fail = async (status, message) => {
    await discardRequestUploads(req);
    return res.status(status).json({ message });
  };
  // Set once the request record exists — from then on the files belong to
  // it and must never be discarded.
  let request = null;
  try {
    const vendor = await Supplier.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!vendor) return fail(404, 'Supplier not found');
    const { type, reason, reviewDate } = req.body;
    if (!['Suspend', 'Blacklist', 'Reinstate'].includes(type)) return fail(400, 'Unknown request type.');
    if (!String(reason || '').trim()) return fail(400, 'A reason is required.');
    if (type === 'Reinstate' && !['Suspended', 'Blacklisted'].includes(vendor.approvalStatus)) {
      return fail(409, 'Only a suspended or blacklisted vendor can be reinstated.');
    }
    if (type === 'Suspend' && vendor.approvalStatus !== 'Approved') {
      return fail(409, 'Only an approved vendor can be suspended.');
    }
    if (type === 'Blacklist' && !['Approved', 'Suspended'].includes(vendor.approvalStatus)) {
      return fail(409, 'Only an approved or suspended vendor can be blacklisted.');
    }
    const files = req.files || [];
    if (type !== 'Reinstate' && files.length === 0) return fail(400, 'Attach at least one evidence file.');
    // Reinstate takes no evidence — drop anything sent with it.
    if (type === 'Reinstate' && files.length) await discardRequestUploads(req);
    const existing = await VendorApprovalRequest.findOne({ vendor: vendor._id, type, status: 'Pending' });
    if (existing) return fail(409, `A ${type.toLowerCase()} request for this vendor is already waiting for approval.`);

    request = await VendorApprovalRequest.create({
      companyId: vendor.companyId,
      vendor: vendor._id,
      type,
      payload: { reason: String(reason).trim(), reviewDate: reviewDate || null },
      previousValue: { approvalStatus: vendor.approvalStatus },
      evidence: type === 'Reinstate' ? [] : files.map(f => ({ fileUrl: `/uploads/vendor-documents/${f.filename}`, fileName: f.originalname })),
      requestedBy: req.user._id,
    });
    await Supplier.updateOne(
      { _id: vendor._id },
      { $push: { activity: activityEntry(`${type} requested`, req.user, String(reason).trim()) } }
    );
    await notifyCompanyAdminOfRequest(request, vendor, req.user);
    res.status(201).json({ message: 'Sent to the Company Admin for approval.', request });
  } catch (error) {
    console.error('Error requesting vendor status change:', error);
    if (!request) await discardRequestUploads(req);
    res.status(500).json({ message: request ? 'Request sent, but a follow-up step failed — refresh to check it.' : 'Error sending request' });
  }
};

export const getSupplierStats = async (req, res) => {
  try {
    const unit = req.user.unit;
    const companyId = req.user.companyId;
    const totalSuppliers = await Supplier.countDocuments({ companyId, unit: { $in: [unit, 'Main'] } });
    const activeSuppliers = await Supplier.countDocuments({
      companyId,
      unit: { $in: [unit, 'Main'] },
      status: 'active'
    });

    res.json({
      total: totalSuppliers,
      active: activeSuppliers,
      inactive: totalSuppliers - activeSuppliers
    });
  } catch (error) {
    console.error('Error fetching supplier stats:', error);
    res.status(500).json({ message: 'Error fetching supplier statistics' });
  }
};

// Export suppliers to Excel
export const exportSuppliersToExcel = async (req, res) => {
  try {
    const unit = req.user.unit;
    const suppliers = await Supplier.find({
      companyId: req.user.companyId, unit: { $in: [unit, 'Main'] }
    }).sort({ createdAt: -1 });

    const excelData = suppliers.map(supplier => ({
      'Supplier Name': supplier.supplierName || supplier.name,
      'Contact Person': supplier.contactPerson || '',
      'Email': supplier.email || '',
      'Phone': supplier.phone || '',
      'Company': supplier.company || '',
      'Address': supplier.address || '',
      'City': supplier.city || '',
      'State': supplier.state || '',
      'Country': supplier.country || '',
      'Postal Code': supplier.postalCode || '',
      'Tax ID': supplier.taxId || '',
      'Payment Terms': supplier.paymentTerms || '',
      'Status': supplier.status || 'active',
      'Created Date': supplier.createdAt ? supplier.createdAt.toISOString().split('T')[0] : ''
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    const colWidths = [];
    Object.keys(excelData[0] || {}).forEach(key => {
      const maxLength = Math.max(
        key.length,
        ...excelData.map(row => String(row[key] || '').length)
      );
      colWidths.push({ width: Math.min(maxLength + 2, 50) });
    });
    worksheet['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Suppliers');

    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx'
    });

    const filename = `suppliers_${Date.now()}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);

    console.log(`Suppliers Excel file sent: ${filename}`);
  } catch (error) {
    console.error('Error exporting suppliers to Excel:', error);
    res.status(500).json({ message: 'Error exporting suppliers to Excel', error: error.message });
  }
};

// Import suppliers from Excel
export const importSuppliersFromExcel = [upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    if (jsonData.length === 0) {
      return res.status(400).json({ message: 'Excel file is empty or has no valid data' });
    }

    const results = {
      total: jsonData.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowNumber = i + 2;

      try {
        const supplierData = {
          supplierName: row['Supplier Name'] || row['Name'] || '',
          contactPerson: row['Contact Person'] || '',
          email: row['Email'] || '',
          phone: row['Phone'] || '',
          company: row['Company'] || '',
          address: row['Address'] || '',
          city: row['City'] || '',
          state: row['State'] || '',
          country: row['Country'] || '',
          postalCode: row['Postal Code'] || row['Zip Code'] || '',
          taxId: row['Tax ID'] || '',
          paymentTerms: row['Payment Terms'] || '',
          status: row['Status'] || 'active',
          unit: req.user.unit, // Important: Assign to current user's unit
          companyId: req.user.companyId,
        };

        if (!supplierData.supplierName) {
          results.errors.push(`Row ${rowNumber}: Supplier name is required`);
          results.failed++;
          continue;
        }

        // Check if supplier with same email exists — scoped to this company,
        // so a different company's vendor with the same email never gets
        // silently overwritten by this import.
        if (supplierData.email) {
          const existingSupplier = await Supplier.findOne({ email: supplierData.email, companyId: req.user.companyId });
          if (existingSupplier) {
            // An import must never bypass the Company Admin's approval of a
            // legal-name change on an already-approved vendor (procurement-v2).
            if (!['Draft', 'Rejected'].includes(existingSupplier.approvalStatus)) {
              for (const field of SENSITIVE_FIELDS) delete supplierData[field];
            }
            await Supplier.findByIdAndUpdate(existingSupplier._id, supplierData);
          } else {
            await Supplier.create(supplierData);
          }
        } else {
          await Supplier.create(supplierData);
        }

        results.successful++;
      } catch (rowError) {
        console.error(`Error processing row ${rowNumber}:`, rowError);
        results.errors.push(`Row ${rowNumber}: ${rowError.message}`);
        results.failed++;
      }
    }

    res.json({
      message: `Import completed: ${results.successful} successful, ${results.failed} failed`,
      success: results.failed === 0,
      results
    });

  } catch (error) {
    console.error('Error importing Excel file:', error);
    res.status(500).json({
      message: 'Error importing Excel file',
      error: error.message,
      success: false
    });
  }
}];

// GET /api/suppliers/vendor-ratings — the vendor score (0–100, blueprint
// §11–§12; services/vendorScoreService.js) per vendor, with its parts and
// standing — for the Vendor Ratings tab and the RFQ/PO vendor cards.
export const getVendorRatingsOverview = async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const unit = req.user.unit;
    const vendors = await Supplier.find({ companyId, unit: { $in: [unit, 'Main'] } })
      .select('supplierName suppliedItems approvalStatus riskClass')
      .lean();

    // Scores for every vendor (a suspended one still has its history),
    // worked out once; the standing reuses them.
    const settings = await getOrCreateSettings(companyId);
    const scores = await computeVendorScores({ companyId, vendorIds: vendors.map(v => v._id), settings });
    const standing = await getVendorStanding(companyId, vendors, { scores });
    const { vendorClaimSummary } = await import('../services/vendorWarrantyClaimService.js');
    const claimsByVendor = await vendorClaimSummary(companyId, vendors.map(v => v._id));
    const data = vendors.map((v) => {
      const s = standing.get(String(v._id));
      const r = scores.get(String(v._id)) || {};
      return {
        _id: v._id,
        supplierName: v.supplierName,
        itemCount: (v.suppliedItems || []).length,
        score: r.score ?? null,
        lifetime: r.lifetime ?? null,
        parts: r.parts || null,
        limitedHistory: !!r.limitedHistory,
        historyEvents: r.historyEvents || 0,
        counts: r.counts || null,
        stage: s?.stage || null,
        watchReason: s?.watchReason || null,
        receivedPOCount: s?.receivedPOCount ?? null,
        riskClass: v.riskClass || null,
        claims: claimsByVendor.get(String(v._id)) || null,
      };
    });

    res.json({ success: true, data, weights: scoreSettingsOf(settings).weights, watchlistBelow: scoreSettingsOf(settings).watchlistBelow });
  } catch (error) {
    console.error('getVendorRatingsOverview error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/suppliers/:id/item-breakdown — the expanded row of the Vendor
// Ratings tab: the evidence behind each part of the vendor score, and the
// vendor's delivered prices per item (avg / last / lowest).
export const getVendorItemBreakdown = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.companyId;
    const unit = req.user.unit;

    const vendor = await Supplier.findOne({ _id: id, companyId, unit: { $in: [unit, 'Main'] } }).lean();
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    const items = await Item.find({ _id: { $in: vendor.suppliedItems || [] } }).select('name code').lean();
    const score = (await computeVendorScores({ companyId, vendorIds: [vendor._id], withEvidence: true })).get(String(vendor._id)) || null;

    const data = await Promise.all(items.map(async (item) => {
      const pricing = await computeVendorItemPricing({ companyId, vendorId: vendor._id, itemObjectId: item._id });
      return { itemId: item._id, itemName: item.name, itemCode: item.code, ...pricing };
    }));

    res.json({ success: true, data: { score, items: data } });
  } catch (error) {
    console.error('getVendorItemBreakdown error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};