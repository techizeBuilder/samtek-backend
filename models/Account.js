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
