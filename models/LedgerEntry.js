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

// Auto-generate entry number
ledgerEntrySchema.pre('validate', async function(next) {
  if (!this.entryNumber) {
    const count = await mongoose.model('LedgerEntry').countDocuments({ companyId: this.companyId });
    this.entryNumber = `LE-${String(count + 1).padStart(6, '0')}`;
  }
  if(next) next();
});

export default mongoose.model('LedgerEntry', ledgerEntrySchema);