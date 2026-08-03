import mongoose from 'mongoose';

// One record per (item, path). `pathType` mirrors Item.internalManufacturing:
// 'Production' for in-house-built items, 'Purchase' for vendor-bought resell
// items — an item is only ever on one path, but the field is kept explicit
// rather than inferred, so historical stats stay correct even if an item's
// internalManufacturing flag changes later.
//
// `avgLeadDays` is a self-updating average, never recomputed from raw
// history: a plain running mean for the first WARMUP_SAMPLES completions
// (see utils/leadTimeStats.js), then an exponential moving average after
// that so it tracks *current* throughput instead of being dragged down by
// years of old data.
const ItemLeadTimeStatsSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  itemCode: { type: String, required: true, trim: true },
  itemName: { type: String, default: '' },
  pathType: { type: String, enum: ['Production', 'Purchase'], required: true },
  avgLeadDays: { type: Number, default: 0, min: 0 },
  sampleCount: { type: Number, default: 0, min: 0 },
  lastUpdatedAt: { type: Date, default: null },
}, { timestamps: true });

ItemLeadTimeStatsSchema.index({ company: 1, itemCode: 1, pathType: 1 }, { unique: true });

export default mongoose.model('ItemLeadTimeStats', ItemLeadTimeStatsSchema);
