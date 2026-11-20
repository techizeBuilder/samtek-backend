import mongoose from 'mongoose';

// Delivery estimate (2026-11-18): the Company Admin's numbers for Sales'
// delivery dates — the buffer (decision B: a % of the working days, never below
// a minimum), packing and dispatch days, and the travel days Sales starts from.
// One per company; read by anyone who can estimate. docs/delivery-estimate/.
const DeliveryEstimateSettingsSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
  bufferPercent: { type: Number, default: 15, min: 0, max: 200 },
  bufferMinDays: { type: Number, default: 2, min: 0, max: 60 },
  packingDays: { type: Number, default: 1, min: 0, max: 30 },
  dispatchDays: { type: Number, default: 1, min: 0, max: 30 },
  travelDaysDefault: { type: Number, default: 2, min: 0, max: 60 },
  savedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  savedByName: { type: String, default: '' },
}, { timestamps: true });

export const ESTIMATE_DEFAULTS = Object.freeze({ bufferPercent: 15, bufferMinDays: 2, packingDays: 1, dispatchDays: 1, travelDaysDefault: 2 });

export default mongoose.model('DeliveryEstimateSettings', DeliveryEstimateSettingsSchema);
