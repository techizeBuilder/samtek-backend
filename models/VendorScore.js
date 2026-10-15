// Monthly snapshot of a vendor's score (blueprint `vendor_scores`, 2026-10-13)
// — written by the nightly sweep (vendorScoreService.runVendorScoreSweep).
// The live score is always worked out fresh; this keeps the trend, and
// whether the vendor was already below the Watchlist line (so the Company
// Admin is told once, when they first drop below it).
import mongoose from 'mongoose';

const part = { type: Number, default: null };

const vendorScoreSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  period: { type: String, required: true },                 // YYYY-MM
  score: { type: Number, default: null },                   // 0–100, last 12 months
  lifetime: { type: Number, default: null },
  parts: { price: part, quality: part, delivery: part, credit: part, warranty: part, response: part },
  weights: { type: mongoose.Schema.Types.Mixed, default: {} },
  limitedHistory: { type: Boolean, default: false },
  belowThreshold: { type: Boolean, default: false },
  computedAt: { type: Date, default: Date.now },
}, { timestamps: true });

vendorScoreSchema.index({ companyId: 1, vendor: 1, period: 1 }, { unique: true });
vendorScoreSchema.index({ companyId: 1, vendor: 1, computedAt: -1 });

export default mongoose.model('VendorScore', vendorScoreSchema);
