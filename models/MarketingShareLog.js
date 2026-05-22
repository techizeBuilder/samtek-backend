import mongoose from 'mongoose';

const MarketingShareLogSchema = new mongoose.Schema({
  action:         { type: String, enum: ['Upload','Edit','Delete','Share'], required: true },
  asset:          { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingAsset', default: null },
  assetName:      { type: String, default: '' },
  performedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Share-specific fields
  shareMethod:    { type: String, enum: ['WhatsApp','Email',''], default: '' },
  customerName:   { type: String, default: '' },
  customerPhone:  { type: String, default: '' },
  customerEmail:  { type: String, default: '' },
  company:        { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

MarketingShareLogSchema.index({ company: 1, action: 1 });
MarketingShareLogSchema.index({ company: 1, createdAt: -1 });
MarketingShareLogSchema.index({ company: 1, asset: 1 });

export default mongoose.model('MarketingShareLog', MarketingShareLogSchema);
