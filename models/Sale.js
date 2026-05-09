import mongoose from 'mongoose';
import { PAYMENT_STATUS } from '../shared/schema.js';

const saleItemSchema = new mongoose.Schema({
  productName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  }
});

const saleSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  items: [saleItemSchema],
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  taxAmount: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  tdsAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  tdsPercent: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: Object.values(PAYMENT_STATUS),
    default: PAYMENT_STATUS.PENDING
  },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Cheque', 'UPI']
  },
  saleDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  paidDate: {
    type: Date
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  balanceAmount: {
    type: Number,
    default: 0
  },
  unit: {
    type: String,
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  dispatch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dispatch'
  },
  notes: {
    type: String
  },
  invoiceType: {
    type: String,
    enum: ['Pakka', 'Kachha'],
    default: 'Pakka'
  },
  gstType: {
    type: String,
    enum: ['CGST_SGST', 'IGST'],
    default: 'CGST_SGST'
  },
  // Track dates when reminders were sent (avoid duplicate emails)
  reminderSentDates: [
    {
      sentAt: { type: Date },
      type: { type: String, enum: ['first', 'second', 'overdue'] }
    }
  ]
}, {
  timestamps: true
});

saleSchema.pre('save', async function () {
  if (!this.invoiceNumber) {
    this.invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  // Calculate balance and update payment status
  this.balanceAmount = this.totalAmount - this.paidAmount;

  if (this.balanceAmount <= 0) {
    this.paymentStatus = 'Paid';
  } else if (this.paidAmount > 0) {
    this.paymentStatus = 'Partially Paid';
  } else {
    // Check for overdue (simplified: if dueDate is in the past)
    if (this.dueDate && new Date(this.dueDate) < new Date()) {
      this.paymentStatus = 'Overdue';
    } else {
      this.paymentStatus = 'Pending';
    }
  }
});

export default mongoose.model('Sale', saleSchema);
