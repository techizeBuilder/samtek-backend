import mongoose from 'mongoose';

const MarketingCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  parentCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCategory', default: null },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });

MarketingCategorySchema.index({ company: 1, parentCategory: 1 });

export default mongoose.model('MarketingCategory', MarketingCategorySchema);
