import mongoose from 'mongoose';

// A Sales Head's proposed add/edit/delete to one of the per-company Lead
// Settings arrays (AdminSettings.leadStages/leadSources/businessTypes/
// documentTypes/leadRejectReasons/salesChecklist). Nothing here is applied
// to AdminSettings until a Company Admin (or Super Admin, as a fallback for
// companies without one yet) approves it — see leadSettingRequestController.js.
const leadSettingRequestSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },

  field: {
    type: String,
    enum: ['leadStages', 'leadSources', 'businessTypes', 'documentTypes', 'leadRejectReasons', 'salesChecklist'],
    required: true
  },

  action: {
    type: String,
    enum: ['add', 'edit', 'delete'],
    required: true
  },

  // Subdocument _id being edited/deleted on AdminSettings[field]; null for 'add'.
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },

  // Proposed field values. For salesChecklist this never includes `key` —
  // that's server-generated only at approval time, same invariant enforced
  // today by adminSettingsController.js's salesChecklistCrud.add.
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  // Snapshot of the live item at request time (edit/delete only) — powers
  // the Company Admin's before/after diff view.
  previousValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },

  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },

  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  reviewRemarks: {
    type: String,
    default: ''
  }
}, { timestamps: true });

leadSettingRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });

export default mongoose.model('LeadSettingRequest', leadSettingRequestSchema);
