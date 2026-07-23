import mongoose from 'mongoose';

// Fixed category list — Production Head/Employee pick one per entry. Kept as
// a single source of truth (also served via
// GET /api/production/expenses/categories) so the frontend dropdown never
// drifts out of sync with the schema enum.
//
// NOTE: Raw Material Cost is logged manually here, same as every other
// category — it is NOT auto-calculated from a machine's BOM. Tying costs to
// a specific Production Order/BOM roll-up would need a much larger feature
// (per-order cost tracking); kept simple like the other Expense modules,
// per explicit instruction to keep this straightforward.
export const PRODUCTION_EXPENSE_CATEGORIES = [
  'Labor Cost',
  'Tool Cost',
  'Job Work Cost',
  'Raw Material Cost',
  'Electricity Cost',
  'Scrap Cost',
  'Rework Cost',
];

const productionExpenseSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  category: {
    type: String,
    required: true,
    enum: PRODUCTION_EXPENSE_CATEGORIES,
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

productionExpenseSchema.index({ companyId: 1, date: -1 });
productionExpenseSchema.index({ companyId: 1, category: 1 });
productionExpenseSchema.index({ companyId: 1, addedBy: 1 });

export default mongoose.model('ProductionExpense', productionExpenseSchema);
