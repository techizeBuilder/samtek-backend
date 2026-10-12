// Company Admin's "Purchase & Vendor Approval" page (procurement-v2,
// 2026-10-08). Client decision: every approval the blueprint gives to Purchase
// Head / Purchase Manager / Management belongs to the Company Admin, on one
// page with a tab per approval type. Vendor tabs first; PR / vendor-selection
// / PO approvals get added here as the rebuild reaches them.
// Same review pattern as leadSettingRequestController.js (Super Admin is a
// fallback reviewer for companies without a Company Admin yet).
import Supplier from '../models/Supplier.js';
import VendorApprovalRequest from '../models/VendorApprovalRequest.js';
import {
  applyApprovedRequest, getVendorStanding, notifyRequesterOfDecision, activityEntry,
  WATCHLIST_RATING_BELOW, WATCHLIST_MIN_EVENTS, PROBATION_RECEIVED_PO_COUNT,
} from '../services/vendorApprovalService.js';

const REQUEST_TYPES = ['NewVendor', 'DetailsChange', 'Suspend', 'Blacklist', 'Reinstate'];

// GET /api/vendor-approvals?type=Suspend,Blacklist&status=Pending
export const listRequests = async (req, res) => {
  try {
    if (!req.user.companyId) {
      return res.status(400).json({ message: 'Your account is not linked to a company.' });
    }
    const query = { companyId: req.user.companyId };
    if (req.query.type) {
      const types = String(req.query.type).split(',').filter(t => REQUEST_TYPES.includes(t));
      if (types.length) query.type = { $in: types };
    }
    if (req.query.status) query.status = { $in: String(req.query.status).split(',') };
    if (req.query.vendor) query.vendor = req.query.vendor;

    const requests = await VendorApprovalRequest.find(query)
      .sort({ requestedAt: -1 })
      .limit(200)
      .populate({ path: 'vendor', select: '-activity', populate: { path: 'suppliedItems', select: 'name code' } })
      .populate('requestedBy', 'fullName username')
      .populate('reviewedBy', 'fullName username')
      .lean();
    res.json({ requests });
  } catch (error) {
    console.error('Error listing vendor approval requests:', error);
    res.status(500).json({ message: 'Error loading approval requests' });
  }
};

// PUT /api/vendor-approvals/:id/review
// body: { decision: 'approve'|'reject', remarks, verification?, riskClass? }
// A NewVendor approval needs every verification checkbox ticked (GST only
// when the vendor has a GSTIN). Rejecting always needs a reason.
export const reviewRequest = async (req, res) => {
  try {
    const { decision, remarks, verification, riskClass } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ message: 'decision must be approve or reject' });
    }
    const request = await VendorApprovalRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (String(request.companyId) !== String(req.user.companyId) && req.user.role !== 'Super Admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    if (request.status !== 'Pending') {
      return res.status(409).json({ message: `This request is already ${request.status.toLowerCase()}.` });
    }
    // Separation of duties (blueprint §23) — nobody approves their own request.
    if (String(request.requestedBy) === String(req.user._id)) {
      return res.status(403).json({ message: 'You can\'t review a request you raised yourself.' });
    }

    const vendor = await Supplier.findOne({ _id: request.vendor, companyId: request.companyId });
    if (!vendor) return res.status(404).json({ message: 'Vendor no longer exists' });
    const reviewRemarks = String(remarks || '').trim();

    if (decision === 'reject') {
      if (!reviewRemarks) return res.status(400).json({ message: 'Give a reason for rejecting.' });
      request.status = 'Rejected';
      request.reviewedBy = req.user._id;
      request.reviewedAt = new Date();
      request.reviewRemarks = reviewRemarks;
      await request.save();
      if (request.type === 'NewVendor') {
        vendor.approvalStatus = 'Rejected';
        vendor.rejectionReason = reviewRemarks;
      }
      vendor.activity.push(activityEntry(`${request.type === 'NewVendor' ? 'Approval' : request.type} rejected`, req.user, reviewRemarks));
      vendor.updatedBy = req.user._id;
      await vendor.save();
      await notifyRequesterOfDecision(request, vendor);
      return res.json({ message: 'Rejected', request });
    }

    if (request.type === 'NewVendor') {
      const v = verification || {};
      const needGst = !!String(vendor.gstNumber || '').trim();
      if ((needGst && !v.gstVerified) || !v.panVerified || !v.bankVerified || !v.documentsVerified) {
        return res.status(400).json({ message: 'Tick every verification check before approving.' });
      }
    }

    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewRemarks = reviewRemarks;
    const updatedVendor = await applyApprovedRequest(request, req.user, { verification, riskClass });
    request.status = 'Approved';
    await request.save();
    await notifyRequesterOfDecision(request, updatedVendor);
    res.json({ message: 'Approved', request, vendor: updatedVendor });
  } catch (error) {
    console.error('Error reviewing vendor approval request:', error);
    res.status(500).json({ message: error.message || 'Error reviewing request' });
  }
};

// DELETE /api/vendor-approvals/:id — the requester withdraws their own
// pending DetailsChange / Suspend / Blacklist / Reinstate request. A
// NewVendor submission is withdrawn from Vendor Master instead
// (POST /api/suppliers/:id/withdraw), since it also moves the vendor back to
// Draft.
export const cancelRequest = async (req, res) => {
  try {
    const request = await VendorApprovalRequest.findOne({ _id: req.params.id, companyId: req.user.companyId });
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status !== 'Pending') return res.status(409).json({ message: 'Only a pending request can be cancelled.' });
    if (request.type === 'NewVendor') {
      return res.status(400).json({ message: 'Withdraw a new-vendor submission from Vendor Master.' });
    }
    if (String(request.requestedBy) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the person who raised this request can cancel it.' });
    }
    request.status = 'Cancelled';
    await request.save();
    await Supplier.updateOne(
      { _id: request.vendor },
      { $push: { activity: activityEntry(`${request.type} request cancelled`, req.user) } }
    );
    res.json({ message: 'Request cancelled', request });
  } catch (error) {
    console.error('Error cancelling vendor approval request:', error);
    res.status(500).json({ message: 'Error cancelling request' });
  }
};

// GET /api/vendor-approvals/watchlist — approved vendors whose current rating
// (vendorRatingService.js) puts them on the Watchlist.
export const getWatchlist = async (req, res) => {
  try {
    const vendors = await Supplier.find({ companyId: req.user.companyId, approvalStatus: 'Approved' })
      .select('supplierName supplierCode contactPerson phone email status approvalStatus')
      .lean();
    const standing = await getVendorStanding(req.user.companyId, vendors);
    const watchlist = vendors
      .map(v => ({ ...v, standing: standing.get(String(v._id)) }))
      .filter(v => v.standing?.stage === 'Watchlist')
      .sort((a, b) => (a.standing.rating ?? 5) - (b.standing.rating ?? 5));
    res.json({
      watchlist,
      thresholds: {
        ratingBelow: WATCHLIST_RATING_BELOW,
        minEvents: WATCHLIST_MIN_EVENTS,
        probationReceivedPOs: PROBATION_RECEIVED_PO_COUNT,
      },
    });
  } catch (error) {
    console.error('Error loading vendor watchlist:', error);
    res.status(500).json({ message: 'Error loading watchlist' });
  }
};

// POST /api/vendor-approvals/watchlist/:vendorId/suspend — the Company Admin
// suspends a watchlisted vendor directly. Recorded as a Suspend request that
// is approved at once (the low rating is the evidence), so the history looks
// the same as a requested suspension.
export const suspendFromWatchlist = async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ message: 'A reason is required.' });
    const vendor = await Supplier.findOne({ _id: req.params.vendorId, companyId: req.user.companyId });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });
    if (vendor.approvalStatus !== 'Approved') {
      return res.status(409).json({ message: `This vendor is ${vendor.approvalStatus}, not Approved.` });
    }
    const pending = await VendorApprovalRequest.findOne({ vendor: vendor._id, type: 'Suspend', status: 'Pending' });
    if (pending) {
      return res.status(409).json({ message: 'A suspension request for this vendor is already waiting — review it in the Suspend / Blacklist tab.' });
    }
    const standing = (await getVendorStanding(req.user.companyId, [vendor])).get(String(vendor._id));
    const request = new VendorApprovalRequest({
      companyId: vendor.companyId,
      vendor: vendor._id,
      type: 'Suspend',
      payload: {
        reason,
        reviewDate: req.body.reviewDate || null,
        fromWatchlist: true,
        rating: standing?.rating ?? null,
        ratingEvents: standing?.eventCount ?? 0,
      },
      previousValue: { approvalStatus: vendor.approvalStatus },
      requestedBy: req.user._id,
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
      reviewRemarks: 'Suspended directly by the Company Admin from the Watchlist',
      status: 'Approved',
    });
    const updatedVendor = await applyApprovedRequest(request, req.user);
    await request.save();
    res.json({ message: 'Vendor suspended', request, vendor: updatedVendor });
  } catch (error) {
    console.error('Error suspending vendor from watchlist:', error);
    res.status(500).json({ message: error.message || 'Error suspending vendor' });
  }
};
