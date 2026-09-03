import mongoose from 'mongoose';
import LeadSettingRequest from '../models/LeadSettingRequest.js';
import notificationService from '../services/notificationService.js';
import { getOrCreateSettings } from './adminSettingsController.js';

const FIELD_LABELS = {
  leadStages: 'Lead Stage',
  leadSources: 'Lead Source',
  businessTypes: 'Business Type',
  documentTypes: 'Document Type',
  leadRejectReasons: 'Lead Reject Reason',
  salesChecklist: 'Sales Checklist',
};

// The text field each array's items are primarily identified/displayed by —
// used only for a cheap "is this empty" validation on add/edit.
const PRIMARY_KEY = {
  leadStages: 'name',
  leadSources: 'name',
  businessTypes: 'name',
  documentTypes: 'name',
  leadRejectReasons: 'label',
  salesChecklist: 'label',
};

// Sales Head proposes a change — nothing on AdminSettings changes yet.
export const createRequest = async (req, res) => {
  try {
    const { field, action, payload, targetId } = req.body;

    if (!Object.keys(FIELD_LABELS).includes(field)) {
      return res.status(400).json({ success: false, message: 'Invalid field' });
    }
    if (!['add', 'edit', 'delete'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    if (!req.user.companyId) {
      return res.status(400).json({ success: false, message: 'Company not assigned' });
    }

    const settings = await getOrCreateSettings(req.user.companyId);
    const arr = settings[field];
    const primaryKey = PRIMARY_KEY[field];
    let previousValue = null;

    if (action === 'add') {
      if (!payload || !String(payload[primaryKey] || '').trim()) {
        return res.status(400).json({ success: false, message: `${FIELD_LABELS[field]} value is required` });
      }
    } else {
      if (!targetId) {
        return res.status(400).json({ success: false, message: 'targetId is required for edit/delete' });
      }
      const item = arr.id(targetId);
      if (!item) {
        return res.status(404).json({ success: false, message: 'Item not found' });
      }
      previousValue = item.toObject();
      if (action === 'edit' && payload && payload[primaryKey] !== undefined && !String(payload[primaryKey]).trim()) {
        return res.status(400).json({ success: false, message: `${FIELD_LABELS[field]} value cannot be empty` });
      }
    }

    // salesChecklist's `key` is server-generated only at approval time —
    // never accept a client-supplied key on the proposed payload.
    const cleanPayload = payload ? { ...payload } : null;
    if (cleanPayload && field === 'salesChecklist') delete cleanPayload.key;

    const request = await LeadSettingRequest.create({
      companyId: req.user.companyId,
      field,
      action,
      targetId: targetId || null,
      payload: action === 'delete' ? null : cleanPayload,
      previousValue,
      requestedBy: req.user._id,
    });

    try {
      await notificationService.createNotification({
        title: 'New Lead Setting request',
        message: `${req.user.fullName || req.user.username} requested to ${action} a ${FIELD_LABELS[field]} point`,
        type: 'lead',
        targetRole: 'Company Admin',
        targetCompanyId: req.user.companyId,
        data: { requestId: request._id.toString() }
      });
    } catch (notifyErr) {
      console.error('Notify Company Admin of lead setting request failed:', notifyErr);
    }

    res.status(201).json({ success: true, request });
  } catch (error) {
    console.error('Error creating lead setting request:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Sales Head's "My Requests" list and Company Admin's approval inbox both
// hit this — same company-scoped query, different filters.
export const listRequests = async (req, res) => {
  try {
    if (!req.user.companyId) {
      return res.status(400).json({ success: false, message: 'Company not assigned' });
    }
    const { status, field, mine } = req.query;
    const query = { companyId: req.user.companyId };
    if (status && status !== 'all') query.status = status;
    if (field && field !== 'all') query.field = field;
    if (mine === 'true') query.requestedBy = req.user._id;

    const requests = await LeadSettingRequest.find(query)
      .populate('requestedBy', 'fullName username')
      .populate('reviewedBy', 'fullName username')
      .sort({ createdAt: -1 });

    res.json({ success: true, requests });
  } catch (error) {
    console.error('Error listing lead setting requests:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Sales Head withdraws their own not-yet-reviewed request — a Pending
// request never took effect, so this is a plain delete rather than a
// status transition.
export const cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await LeadSettingRequest.findById(id);
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
    console.error('Error cancelling lead setting request:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Company Admin (or Super Admin, as a fallback for companies without a
// Company Admin user yet) approves or rejects. Approval is the only place
// AdminSettings actually changes.
export const reviewRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, remarks } = req.body;
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ success: false, message: "decision must be 'approve' or 'reject'" });
    }

    const request = await LeadSettingRequest.findById(id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (String(request.companyId) !== String(req.user.companyId) && req.user.role !== 'Super Admin') {
      return res.status(403).json({ success: false, message: 'Not authorized for this company' });
    }
    if (request.status !== 'Pending') {
      return res.status(400).json({ success: false, message: `Request already ${request.status.toLowerCase()}` });
    }

    if (decision === 'approve') {
      const settings = await getOrCreateSettings(request.companyId);
      const arr = settings[request.field];

      if (request.action === 'add') {
        const item = { ...request.payload };
        if (request.field === 'salesChecklist') {
          item.key = new mongoose.Types.ObjectId().toString();
        }
        arr.push(item);
      } else if (request.action === 'edit') {
        const item = arr.id(request.targetId);
        if (!item) return res.status(404).json({ success: false, message: 'Item no longer exists — it may have been deleted since this request was made' });
        const updates = { ...request.payload };
        delete updates.key; // immutable, even on edit
        Object.assign(item, updates);
      } else if (request.action === 'delete') {
        arr.pull({ _id: request.targetId });
      }

      await settings.save();
    }

    request.status = decision === 'approve' ? 'Approved' : 'Rejected';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.reviewRemarks = remarks || '';
    await request.save();

    try {
      await notificationService.createNotification({
        title: `Lead Setting request ${request.status.toLowerCase()}`,
        message: `Your ${request.action} request for ${FIELD_LABELS[request.field]} was ${request.status.toLowerCase()}${remarks ? `: ${remarks}` : ''}`,
        type: 'lead',
        targetUserId: request.requestedBy,
        targetCompanyId: request.companyId,
        data: { requestId: request._id.toString() }
      });
    } catch (notifyErr) {
      console.error('Notify requester of lead setting review failed:', notifyErr);
    }

    res.json({ success: true, request });
  } catch (error) {
    console.error('Error reviewing lead setting request:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
