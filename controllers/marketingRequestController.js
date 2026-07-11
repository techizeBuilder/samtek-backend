import MarketingRequest from '../models/MarketingRequest.js';
import MarketingAsset from '../models/MarketingAsset.js';
import Lead from '../models/Lead.js';
import notificationService from '../services/notificationService.js';

const cid = (req) => req.user.companyId;
const uid = (req) => req.user._id;

const REQUEST_POPULATE = [
  { path: 'lead', select: 'leadCode companyName contactPerson email mobile' },
  { path: 'category', select: 'name' },
  { path: 'subcategory', select: 'name' },
  { path: 'requestedBy', select: 'username fullName' },
  { path: 'resolvedBy', select: 'username fullName' },
  { path: 'sentAssets', select: 'fileName fileType fileUrl thumbnail product description' },
];

// ─── CREATE (Sales → Marketing) ───────────────────────────────────────────────
export const createRequest = async (req, res) => {
  try {
    const { leadId, category, subcategory, productName, notes } = req.body;
    if (!leadId) return res.status(400).json({ success: false, message: 'Lead is required' });
    if (!productName?.trim()) return res.status(400).json({ success: false, message: 'Product name is required' });

    const lead = await Lead.findOne({ _id: leadId, companyId: cid(req) });
    if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });

    const request = await MarketingRequest.create({
      lead: lead._id,
      category: category || null,
      subcategory: subcategory || null,
      productName: productName.trim(),
      notes: notes || '',
      requestedBy: uid(req),
      company: cid(req),
    });

    // Notify Marketing Head (bell + pusher, company scoped) — failure yahan request ko block na kare
    try {
      await notificationService.createNotification({
        title: 'New Marketing Content Request',
        message: `${req.user.username || 'Sales'} requested content for "${productName.trim()}" (Lead ${lead.leadCode})`,
        type: 'marketing', icon: 'megaphone', priority: 'high',
        targetRole: 'Marketing Head', targetCompanyId: cid(req),
        data: { requestId: request._id, leadId: lead._id, leadCode: lead.leadCode, productName: productName.trim() },
      });
    } catch (notifErr) {
      console.error('Marketing request notification failed:', notifErr.message);
    }

    res.status(201).json({ success: true, data: request, message: 'Marketing request sent' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── MY REQUESTS (Sales side) ─────────────────────────────────────────────────
export const getMyRequests = async (req, res) => {
  try {
    const requests = await MarketingRequest.find({ company: cid(req), requestedBy: uid(req) })
      .populate(REQUEST_POPULATE).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── ALL REQUESTS (Marketing side) ────────────────────────────────────────────
export const getAllRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { company: cid(req) };
    if (status) query.status = status;
    const requests = await MarketingRequest.find(query)
      .populate(REQUEST_POPULATE).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── MATCHING ASSETS (for approve flow) ───────────────────────────────────────
// Product name se match karo; na mile to subcategory, fir category pe fallback.
export const getMatchingAssets = async (req, res) => {
  try {
    const request = await MarketingRequest.findOne({ _id: req.params.id, company: cid(req) });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const company = cid(req);
    const escaped = request.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const assetSelect = 'fileName fileType fileUrl thumbnail product description category subcategory';

    let matchLevel = 'none';
    let assets = await MarketingAsset.find({ company, product: new RegExp(escaped, 'i') })
      .select(assetSelect).populate('category subcategory', 'name').sort({ createdAt: -1 }).lean();
    if (assets.length) matchLevel = 'product';

    if (!assets.length && request.subcategory) {
      assets = await MarketingAsset.find({ company, subcategory: request.subcategory })
        .select(assetSelect).populate('category subcategory', 'name').sort({ createdAt: -1 }).lean();
      if (assets.length) matchLevel = 'subcategory';
    }

    if (!assets.length && request.category) {
      assets = await MarketingAsset.find({ company, category: request.category })
        .select(assetSelect).populate('category subcategory', 'name').sort({ createdAt: -1 }).lean();
      if (assets.length) matchLevel = 'category';
    }

    res.json({ success: true, data: { matchLevel, assets } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── APPROVE + SEND ASSETS ────────────────────────────────────────────────────
export const approveRequest = async (req, res) => {
  try {
    const { assetIds } = req.body;
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one asset to send' });
    }

    const request = await MarketingRequest.findOne({ _id: req.params.id, company: cid(req) }).populate('lead', 'leadCode');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'Pending') return res.status(400).json({ success: false, message: `Request is already ${request.status}` });

    // Sirf apni company ke valid assets hi attach ho
    const validAssets = await MarketingAsset.find({ _id: { $in: assetIds }, company: cid(req) }).select('_id');
    if (!validAssets.length) return res.status(400).json({ success: false, message: 'No valid assets selected' });

    request.status = 'Approved';
    request.sentAssets = validAssets.map(a => a._id);
    request.resolvedBy = uid(req);
    request.resolvedAt = new Date();
    await request.save();

    // Personal notification — sirf request karne wale sales user ko
    try {
      await notificationService.createNotification({
        title: 'Marketing Request Approved',
        message: `Your content request for "${request.productName}" (Lead ${request.lead?.leadCode || ''}) has been approved. ${validAssets.length} file(s) shared.`,
        type: 'marketing', icon: 'check-circle', priority: 'high',
        targetUserId: request.requestedBy,
        data: { requestId: request._id, productName: request.productName },
      });
    } catch (notifErr) {
      console.error('Approve notification failed:', notifErr.message);
    }

    const populated = await MarketingRequest.findById(request._id).populate(REQUEST_POPULATE).lean();
    res.json({ success: true, data: populated, message: 'Request approved and content sent' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── REJECT ───────────────────────────────────────────────────────────────────
export const rejectRequest = async (req, res) => {
  try {
    const request = await MarketingRequest.findOne({ _id: req.params.id, company: cid(req) }).populate('lead', 'leadCode');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'Pending') return res.status(400).json({ success: false, message: `Request is already ${request.status}` });

    request.status = 'Rejected';
    request.rejectReason = req.body.reason || '';
    request.resolvedBy = uid(req);
    request.resolvedAt = new Date();
    await request.save();

    try {
      await notificationService.createNotification({
        title: 'Marketing Request Rejected',
        message: `Your content request for "${request.productName}" (Lead ${request.lead?.leadCode || ''}) was rejected.${request.rejectReason ? ` Reason: ${request.rejectReason}` : ''}`,
        type: 'marketing', icon: 'x-circle', priority: 'medium',
        targetUserId: request.requestedBy,
        data: { requestId: request._id, productName: request.productName },
      });
    } catch (notifErr) {
      console.error('Reject notification failed:', notifErr.message);
    }

    res.json({ success: true, data: request, message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
