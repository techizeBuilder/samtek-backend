import mongoose from 'mongoose';

const bankAccountSchema = new mongoose.Schema({
  accountName: {
    type: String,
    required: true,
    trim: true
  },
  accountNumber: {
    type: String,
    required: true,
    trim: true
  },
  bankName: {
    type: String,
    required: true,
    trim: true
  },
  branchName: {
    type: String,
    trim: true
  },
  ifscCode: {
    type: String,
    trim: true
  },
  accountType: {
    type: String,
    enum: ['Savings', 'Current', 'Cash', 'FD', 'Other'],
    default: 'Current'
  },
  openingBalance: {
    type: Number,
    default: 0
  },
  currentBalance: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
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
  }
}, {
  timestamps: true
});

// Index for performance
bankAccountSchema.index({ companyId: 1 });
bankAccountSchema.index({ accountNumber: 1 });
bankAccountSchema.index({ isActive: 1 });

export default mongoose.model('BankAccount', bankAccountSchema);