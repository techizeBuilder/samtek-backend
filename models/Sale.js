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
  // Advanced payment already received from Lead (before invoice)
  advancedPaymentAmount: {
    type: Number,
    default: 0,
    min: 0
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
  // Gate Pass & NOC Information
  gatePass: {
    nocStatus: { type: String, enum: ['Pending', 'Approved'], default: 'Pending' },
    gatePassNumber: { type: String },
    generatedAt: { type: Date },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['Pending', 'Generated'], default: 'Pending' },
    vehicleNumber: { type: String },
    driverName: { type: String },
    contactNumber: { type: String }
  },
  // Product Type (defined by Store Head)
  productType: {
    type: String,
    enum: ['In-house Manufactured', 'Purchased (Trading Product)'],
    default: null
  },
  // Inventory Availability (defined by Store Head)
  isAvailableInInventory: {
    type: String,
    enum: ['Available', 'Not Available'],
    default: null
  },
  // Store QC Status - visible to Store team to track where item went
  // Available path:     'Goes to QC' -> 'Approved from QC' | 'Rejected from QC'
  // Purchase path:      'Goes to Purchase' -> 'Purchase Completed'
  // Production path:    'Goes to Production' -> 'Production Completed'
  storeQCStatus: {
    type: String,
    enum: [
      null,
      'Goes to QC',
      'Approved from QC',
      'Rejected from QC',
      'Goes to Purchase',
      'Purchase Completed',
      'Goes to Production',
      'Production Completed'
    ],
    default: null
  },
  // Track dates when reminders were sent (avoid duplicate emails)
  reminderSentDates: [
    {
      sentAt: { type: Date },
      type: { type: String, enum: ['first', 'second', 'overdue'] }
    }
  ],
  paymentProofUrl: { type: String, default: '' }
}, {
  timestamps: true
});

saleSchema.pre('save', async function () {
  if (!this.invoiceNumber) {
    this.invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }

  // Calculate balance: totalAmount - advancedPayment - any other paidAmount
  const totalPaid = (this.advancedPaymentAmount || 0) + (this.paidAmount || 0);
  this.balanceAmount = this.totalAmount - totalPaid;

  if (this.balanceAmount <= 0) {
    this.paymentStatus = 'Paid';
  } else if (totalPaid > 0) {
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
//sales check