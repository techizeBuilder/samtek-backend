// A warranty claim we made to a vendor (procurement-v2, serial numbers
// Part 2, 2026-10-13 — docs/procurement-v2/serial-numbers-and-warranty-
// discussion-2026-10.md §5). Entered by hand on Complaints → Support: the
// customer gives the serial, we find the unit (PurchasedUnit, Part 1) or pick
// the vendor + item, and record what we told the vendor, how they answered,
// how it ended — and how satisfied we were with their handling.
//
// What it feeds: the vendor score's Warranty / After-Sales 10% (blueprint
// §11: warranty duration, claim response time, claim resolution).
import mongoose from 'mongoose';

export const DEFECT_TYPES = ['Electrical', 'Mechanical', 'Performance', 'Physical damage', 'Missing part', 'Other'];
export const SEVERITIES = ['Minor', 'Major', 'Critical'];
export const UNDER_WARRANTY = ['Yes', 'No', 'Unsure'];
export const CLAIM_OUTCOMES = ['Repaired', 'Replaced', 'Credit note', 'Refused', 'Not covered'];
export const CLAIM_STATUSES = ['Waiting for vendor', 'Vendor responded', 'Closed'];

const vendorWarrantyClaimSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  number: { type: String, required: true },                       // VWC-0001

  // The unit — from our serial records, or picked by hand.
  purchasedUnit: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchasedUnit', default: null },
  serialNumber: { type: String, default: '', trim: true },
  serialKey: { type: String, default: '' },
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', default: null },
  itemName: { type: String, default: '' },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  vendorName: { type: String, default: '' },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
  poNumber: { type: String, default: '' },
  receivedAt: { type: Date, default: null },                      // when Store received the unit
  vendorWarrantyMonths: { type: Number, default: 0 },
  monthsSource: { type: String, enum: ['serial', 'item'], default: 'item' },
  underWarranty: { type: String, enum: UNDER_WARRANTY, default: 'Unsure' },

  // The complaint.
  customerName: { type: String, default: '' },
  ticketRef: { type: String, default: '' },                       // free text, not linked
  problem: { type: String, required: true },
  defectType: { type: String, enum: DEFECT_TYPES, default: 'Other' },
  severity: { type: String, enum: SEVERITIES, default: 'Major' },
  evidence: [{ url: String, name: String, at: { type: Date, default: Date.now } }],

  // The vendor.
  reportedToVendorAt: { type: Date, required: true },
  vendorRespondedAt: { type: Date, default: null },
  vendorResponse: { type: String, default: '' },

  // How it ended.
  outcome: { type: String, enum: [...CLAIM_OUTCOMES, null], default: null },
  resolvedAt: { type: Date, default: null },
  costToUs: { type: Number, default: 0, min: 0 },
  notes: { type: String, default: '' },
  satisfaction: {
    rating: { type: Number, min: 1, max: 5, default: null },
    comment: { type: String, default: '' },
  },

  status: { type: String, enum: CLAIM_STATUSES, default: 'Waiting for vendor' },
  history: [{ at: { type: Date, default: Date.now }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, byName: String, text: String }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' },
}, { timestamps: true });

vendorWarrantyClaimSchema.index({ companyId: 1, number: 1 }, { unique: true });
vendorWarrantyClaimSchema.index({ companyId: 1, status: 1 });
vendorWarrantyClaimSchema.index({ companyId: 1, vendor: 1 });
vendorWarrantyClaimSchema.index({ companyId: 1, serialKey: 1 });

export default mongoose.model('VendorWarrantyClaim', vendorWarrantyClaimSchema);
