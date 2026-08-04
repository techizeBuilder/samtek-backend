import mongoose from 'mongoose';

// Fixed type list — kept as a single source of truth (also served via
// GET /api/marketing/events/types) so the frontend dropdown never drifts
// out of sync with the schema enum. Mirrors MarketingExpense's pattern.
export const EVENT_TYPES = [
  'Exhibition',
  'Trade Fair',
  'Product Launch',
  'Seminar',
  'Conference',
  'Promotional Campaign',
  'Corporate Event',
  'Other',
];

const eventFlyerSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  eventName: {
    type: String,
    required: true,
    trim: true,
  },
  eventType: {
    type: String,
    required: true,
    enum: EVENT_TYPES,
  },
  eventDate: {
    type: Date,
    required: true,
  },
  imageUrl: {
    type: String,
    required: true,
    trim: true,
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true,
});

eventFlyerSchema.index({ companyId: 1, eventDate: -1 });
eventFlyerSchema.index({ companyId: 1, eventType: 1 });

export default mongoose.model('EventFlyer', eventFlyerSchema);
