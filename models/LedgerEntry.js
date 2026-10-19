import mongoose from 'mongoose';

const ledgerEntrySchema = new mongoose.Schema({
  entryNumber: {
    type: String,
    required: true,
    unique: true
  },
  entryDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  entryType: {
    type: String,
    enum: ['Receipt', 'Payment', 'Journal', 'Contra'],
    required: true
  },
  referenceType: {
    type: String,
    enum: ['Lead Payment', 'Customer Payment', 'Vendor Payment', 'Expense', 'Sale', 'Purchase', 'Other'],
    required: true
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  referenceNumber: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  // Double Entry Accounting - Each entry has multiple line items
  lineItems: [{
    accountType: {
      type: String,
      enum: ['Bank', 'Cash', 'Customer', 'Vendor', 'Income', 'Expense', 'Asset', 'Liability', 'Equity'],
      required: true
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    accountName: {
      type: String,
      required: true
    },
    debitAmount: {
      type: Number,
      default: 0
    },
    creditAmount: {
      type: Number,
      default: 0
    },
    description: String
  }],
  status: {
    type: String,
    enum: ['Draft', 'Posted', 'Cancelled'],
    default: 'Posted'
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedDate: Date
}, {
  timestamps: true
});

// Index for performance
ledgerEntrySchema.index({ companyId: 1 });
ledgerEntrySchema.index({ entryDate: 1 });
ledgerEntrySchema.index({ entryType: 1 });
ledgerEntrySchema.index({ referenceType: 1 });
ledgerEntrySchema.index({ referenceId: 1 });
ledgerEntrySchema.index({ status: 1 });

// Auto-generate entry number — the highest in use + 1, across ALL companies
// (bug B14, 2026-10-19). It counted one company's entries, but the number is
// unique for the whole database, so a second company's first entry
// (LE-000001 again) failed to save, and a deleted entry made the next number
// collide too. Numeric ordering so LE-1000000 sorts after LE-999999.
ledgerEntrySchema.pre('validate', async function(next) {
  if (!this.entryNumber) {
    const last = await mongoose.model('LedgerEntry').findOne({ entryNumber: /^LE-\d+$/ })
      .sort({ entryNumber: -1 }).collation({ locale: 'en', numericOrdering: true }).select('entryNumber').lean();
    const n = last ? Number(last.entryNumber.slice(3)) + 1 : 1;
    this.entryNumber = `LE-${String(n).padStart(6, '0')}`;
  }
  if(next) next();
});

export default mongoose.model('LedgerEntry', ledgerEntrySchema);