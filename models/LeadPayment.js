import mongoose from 'mongoose';

const leadPaymentSchema = new mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  leadCode: {
    type: String,
    required: true
  },
  companyName: {
    type: String,
    required: true
  },
  contactPerson: {
    type: String,
    required: true
  },
  mobile: String,
  email: String,
  amount: {
    type: Number,
    required: true,
    default: 0
  },
  paymentDate: {
    type: Date,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Cheque', 'Bank Transfer', 'UPI', 'Card', 'Other'],
    default: 'Bank Transfer'
  },
  bankAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankAccount'
  },
  transactionId: String,
  remarks: String,
  status: {
    type: String,
    enum: ['Pending', 'Verified', 'Rejected'],
    default: 'Pending'
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedDate: Date,
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Index for performance
leadPaymentSchema.index({ companyId: 1 });
leadPaymentSchema.index({ leadId: 1 });
leadPaymentSchema.index({ status: 1 });

export default mongoose.model('LeadPayment', leadPaymentSchema);