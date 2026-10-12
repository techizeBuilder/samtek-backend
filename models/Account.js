import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema({
  accountNumber: {
    type: String,
    required: true,
    unique: true
  },
  accountName: {
    type: String,
    required: true
  },
  accountType: {
    type: String,
    enum: ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'],
    required: true
  },
  balance: {
    type: Number,
    default: 0
  },
  unit: {
    type: String,
    required: true
  },
  parentAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  description: {
    type: String
  },
  isBankOrCash: {
    type: Boolean,
    default: false
  },
  bankDetails: {
    bankName: String,
    accountNumber: String,
    ifsc: String,
    branch: String,
    upiId: String
  },
  // Purchase money accounts (procurement-v2, 2026-10-12) are kept per
  // company + unit — before this, accounts were found by unit name only, so
  // two companies with a unit called "Main" would have shared them. Older
  // accounts (bank / cash etc.) have no companyId and are unaffected.
  // systemKey marks an account the software creates and posts to itself
  // (services/purchaseLedgerService.js), e.g. 'advance_to_vendors'.
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null,
    index: true
  },
  systemKey: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

const transactionSchema = new mongoose.Schema({
  transactionNumber: {
    type: String,
    required: true,
    unique: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  description: {
    type: String,
    required: true
  },
  reference: {
    type: String
  },
  entries: [{
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true
    },
    debit: {
      type: Number,
      default: 0,
      min: 0
    },
    credit: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  unit: {
    type: String,
    required: true
  },
  relatedDocument: {
    type: String,
    enum: ['Sale', 'Purchase', 'Order', 'Payment', 'Receipt', 'PurchaseReturn', 'SalesReturn', 'Expense']
  },
  relatedDocumentId: {
    type: mongoose.Schema.Types.ObjectId
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isReconciled: {
    type: Boolean,
    default: false
  },
  reconciliationDate: {
    type: Date
  },
  clearedAmount: {
    type: Number
  },
  mode: {
    type: String,
    enum: ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'NEFT', 'Other'],
    default: 'Cash'
  }
}, {
  timestamps: true
});

transactionSchema.pre('save', async function () {
  if (!this.transactionNumber) {
    this.transactionNumber = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
});

export const Account = mongoose.model('Account', accountSchema);
export const Transaction = mongoose.model('Transaction', transactionSchema);
