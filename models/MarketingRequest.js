import mongoose from 'mongoose';

const MarketingRequestSchema = new mongoose.Schema({
  lead:        { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  category:    { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCategory', default: null },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCategory', default: null },
  productName: { type: String, required: true, trim: true },
  notes:       { type: String, default: '' },
  status:      { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  resolvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt:  { type: Date, default: null },
  rejectReason:{ type: String, default: '' },
  sentAssets:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'MarketingAsset' }],
  company:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

MarketingRequestSchema.index({ company: 1, status: 1, createdAt: -1 });
MarketingRequestSchema.index({ company: 1, requestedBy: 1, createdAt: -1 });

export default mongoose.model('MarketingRequest', MarketingRequestSchema);
