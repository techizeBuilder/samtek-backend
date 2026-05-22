import mongoose from 'mongoose';

const MarketingAssetSchema = new mongoose.Schema({
  fileName:      { type: String, required: true, trim: true },
  originalName:  { type: String, default: '' },
  fileType:      { type: String, enum: ['PDF','DOC','DOCX','JPG','JPEG','PNG','WEBP','MP4','MOV'], required: true },
  fileUrl:       { type: String, required: true },
  thumbnail:     { type: String, default: '' },
  category:      { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCategory', default: null },
  subcategory:   { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCategory', default: null },
  product:       { type: String, default: '', trim: true },
  description:   { type: String, default: '' },
  tags:          [{ type: String, trim: true }],
  versionNumber: { type: String, default: '1.0' },
  shareCount:    { type: Number, default: 0 },
  uploadedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  company:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

MarketingAssetSchema.index({ company: 1, fileType: 1 });
MarketingAssetSchema.index({ company: 1, category: 1 });
MarketingAssetSchema.index({ company: 1, tags: 1 });

export default mongoose.model('MarketingAsset', MarketingAssetSchema);
