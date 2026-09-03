import SalesItemRequest from '../models/SalesItemRequest.js';
import notificationService from '../services/notificationService.js';

// Sales requests R&D to add a brand-new product, from a specific lead's
// Quotation page. Image is optional (itemUpload.single('image')).
export const createRequest = async (req, res) => {
  try {
    const { leadId, leadCode, productName, production, category, application, quantity } = req.body;

    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' });
    }
    if (!productName || !productName.trim()) {
      return res.status(400).json({ success: false, message: 'Product Name is required' });
    }
    if (!req.user.companyId) {
      return res.status(400).json({ success: false, message: 'Company not assigned' });
    }

    const image = req.file ? `/uploads/items/images/${req.file.filename}` : null;

    const request = await SalesItemRequest.create({
      companyId: req.user.companyId,
      leadId,
      leadCode: leadCode || '',
      productName: productName.trim(),
      production: production || '',
      category: category || '',
      image,
      application: application || '',
      quantity: quantity ? Number(quantity) : 1,
      requestedBy: req.user._id,
    });

    try {
      await notificationService.notifyRoles(['Research & Development Head', 'Research Development Employee'], {
        title: 'New Sales Item Request',
        message: `${req.user.fullName || req.user.username} requested a new product: ${request.productName}${leadCode ? ` (Lead #${leadCode})` : ''}`,
        type: 'sales_item_request',
        targetCompanyId: req.user.companyId,
        data: { requestId: request._id.toString() }
      });
    } catch (notifyErr) {
      console.error('Notify R&D of sales item request failed:', notifyErr);
    }

    res.status(201).json({ success: true, request });
  } catch (error) {
    console.error('Error creating sales item request:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Sales's "requests for this lead" view and R&D's inbox both hit this —
// same company-scoped query, different filters.
export const listRequests = async (req, res) => {
  try {
    if (!req.user.companyId) {
      return res.status(400).json({ success: false, message: 'Company not assigned' });
    }
    const { status, leadId, mine } = req.query;
    const query = { companyId: req.user.companyId };
    if (status && status !== 'all') query.status = status;
    if (leadId) query.leadId = leadId;
    if (mine === 'true') query.requestedBy = req.user._id;

    const requests = await SalesItemRequest.find(query)
      .populate('requestedBy', 'fullName username')
      .populate('reviewedBy', 'fullName username')
      .sort({ createdAt: -1 });

    res.json({ success: true, requests });
  } catch (error) {
    console.error('Error listing sales item requests:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// R&D approves/rejects — a plain status change. The actual product still
// gets added to the catalog separately via R&D's own Product Master flow,
// using this request as reference.
export const reviewRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, remarks } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: "decision must be 'approve' or 'reject'" });
    }

    const request = await SalesItemRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (String(request.companyId) !== String(req.user.companyId) && req.user.role !== 'Super Admin') {
      return res.status(403).json({ success: false, message: 'Not authorized for this company' });
    }
    if (request.status !== 'Pending') {
      return res.status(400).json({ success: false, message: `Request already ${request.status.toLowerCase()}` });
    }

    request.status = decision === 'approve' ? 'Approved' : 'Rejected';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewRemarks = remarks || '';
    await request.save();

    try {
      await notificationService.createNotification({
        title: `Sales Item Request ${request.status.toLowerCase()}`,
        message: `Your request for "${request.productName}" was ${request.status.toLowerCase()}${remarks ? `: ${remarks}` : ''}`,
        type: 'sales_item_request',
        targetUserId: request.requestedBy,
        targetCompanyId: request.companyId,
        data: { requestId: request._id.toString() }
      });
    } catch (notifyErr) {
      console.error('Notify requester of sales item request review failed:', notifyErr);
    }

    res.json({ success: true, request });
  } catch (error) {
    console.error('Error reviewing sales item request:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Sales withdraws their own not-yet-reviewed request.
export const cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await SalesItemRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (String(request.requestedBy) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own requests' });
    }
    if (request.status !== 'Pending') {
      return res.status(400).json({ success: false, message: `Cannot cancel a request that is already ${request.status.toLowerCase()}` });
    }
    await request.deleteOne();
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling sales item request:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
