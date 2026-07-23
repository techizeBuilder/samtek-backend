import mongoose from 'mongoose';

// Fixed category list — Marketing Head/Employee pick one per entry. Kept as
// a single source of truth (also served via GET /api/marketing/expenses/categories)
// so the frontend dropdown never drifts out of sync with the schema enum.
export const MARKETING_EXPENSE_CATEGORIES = [
  'Video Shooting Cost',
  'Ads Cost',
  'Printing & Labeling Cost',
  'Graphics Cost',
  'Marketing Consultant Cost',
  'Field Marketing Cost',
  'Influencer Marketing Cost',
  'Marketing Tools Cost',
  'SEO Cost',
  'Server Cost',
  'Marketing Platform Cost',
  'Web Development Cost',
  'Video Editing Cost',
  'Software/Subscription Cost',
  'Other Marketing Expense',
];

const marketingExpenseSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  category: {
    type: String,
    required: true,
    enum: MARKETING_EXPENSE_CATEGORIES,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  // The date the expense actually happened (may be backdated); separate from
  // createdAt below, which is the immutable "logged at" timestamp.
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
}, {
  timestamps: true, // createdAt = exact date+time this expense was logged
});

marketingExpenseSchema.index({ companyId: 1, date: -1 });
marketingExpenseSchema.index({ companyId: 1, category: 1 });
marketingExpenseSchema.index({ companyId: 1, addedBy: 1 });

export default mongoose.model('MarketingExpense', marketingExpenseSchema);
