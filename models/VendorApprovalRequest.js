import mongoose from 'mongoose';

// One request for the Company Admin to approve on the "Purchase & Vendor
// Approval" page (procurement-v2, 2026-10-08). Same shape/idea as
// LeadSettingRequest.js. Nothing in `payload` touches the Supplier until a
// Company Admin (or Super Admin, as a fallback for companies without one)
// approves it — see vendorApprovalService.js applyApprovedRequest.
//
//   NewVendor     — a Draft vendor submitted for first approval.
//   DetailsChange — an approved vendor's legal name / GSTIN / PAN / bank
//                   details edited; old values stay live until approved.
//   Suspend / Blacklist / Reinstate — lifecycle change with a reason (and
//                   evidence for Suspend/Blacklist).
const vendorApprovalRequestSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['NewVendor', 'DetailsChange', 'Suspend', 'Blacklist', 'Reinstate'],
    required: true
  },
  // DetailsChange: the proposed values ({ supplierName?, gstNumber?,
  // panNumber?, bankDetails? }). Suspend/Blacklist/Reinstate:
  // { reason, reviewDate? }. NewVendor: null.
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  // Snapshot of the live values at request time — the before/after view.
  previousValue: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  evidence: [{
    fileUrl: { type: String, required: true },
    fileName: { type: String, default: '' }
  }],
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
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

vendorApprovalRequestSchema.index({ companyId: 1, status: 1, type: 1 });
// At most one Pending request per vendor+type — a second edit to the same
// vendor's bank details while one is waiting is merged into that request
// instead (supplierController.js updateSupplier).
vendorApprovalRequestSchema.index(
  { vendor: 1, type: 1 },
  { unique: true, partialFilterExpression: { status: 'Pending' } }
);

export default mongoose.model('VendorApprovalRequest', vendorApprovalRequestSchema);
