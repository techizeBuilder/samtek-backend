import mongoose from 'mongoose';

// Platform-wide Sales Checklist (Deal Won commitments), configured once by
// Super Admin (Admin Settings > Sales Checklist) and shared by every company —
// Super Admin isn't tied to any one company, so this list must not live on
// the per-company AdminSettings doc (it used to, keyed off the Super Admin's
// own incidental companyId, which meant only that one company's Sales team
// ever saw it). Singleton collection: exactly one document, no companyId.
const globalSalesChecklistSchema = new mongoose.Schema({
  salesChecklist: [{
    key: { type: String, required: true },
    label: { type: String, required: true },
    valueType: { type: String, enum: ['none', 'text', 'number'], default: 'text' },
    valueLabel: { type: String, default: '' },
    valuePlaceholder: { type: String, default: '' },
    order: { type: Number, default: 0 }
  }],
}, { timestamps: true });

export default mongoose.model('GlobalSalesChecklist', globalSalesChecklistSchema);
