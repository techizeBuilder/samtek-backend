import mongoose from 'mongoose';

// Fixed category list — Accounts Head/Employee pick one per entry. Kept as a
// single source of truth (also served via
// GET /api/accounts/tender-expenses/categories) so the frontend dropdown
// never drifts out of sync with the schema enum.
export const TENDER_EXPENSE_CATEGORIES = [
  'EMD Cost',
  'Bank Guarantee Cost',
  'Tender Fee Payment Processing Cost',
];

const tenderExpenseSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  category: {
    type: String,
    required: true,
    enum: TENDER_EXPENSE_CATEGORIES,
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

tenderExpenseSchema.index({ companyId: 1, date: -1 });
tenderExpenseSchema.index({ companyId: 1, category: 1 });
tenderExpenseSchema.index({ companyId: 1, addedBy: 1 });

export default mongoose.model('TenderExpense', tenderExpenseSchema);
