import mongoose from 'mongoose';

// Fixed category list — HR-Admin picks one per entry. Kept as a single
// source of truth (also served via GET /api/hr-expenses/categories) so the
// frontend dropdown never drifts out of sync with the schema enum.
export const HR_EXPENSE_CATEGORIES = [
  'All Employee Salary',
  'Training Cost',
  'Party and Function Cost',
  'Event Cost',
];

const hrExpenseSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  category: {
    type: String,
    required: true,
    enum: HR_EXPENSE_CATEGORIES,
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

hrExpenseSchema.index({ companyId: 1, date: -1 });
hrExpenseSchema.index({ companyId: 1, category: 1 });
hrExpenseSchema.index({ companyId: 1, addedBy: 1 });

export default mongoose.model('HrExpense', hrExpenseSchema);
