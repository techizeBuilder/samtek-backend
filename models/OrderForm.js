import mongoose from 'mongoose';

const orderFormItemSchema = new mongoose.Schema({
  sNo: { type: Number },
  mcCode: { type: String, trim: true },
  itemName: { type: String, trim: true },
  specification: { type: String, trim: true },
  hsnCode: { type: String, trim: true },
  qty: { type: Number, default: 0, min: 0 },
  billAmount: { type: Number, default: 0, min: 0 },
  gstAmount: { type: Number, default: 0, min: 0 },
  quotationAmount: { type: Number, default: 0, min: 0 },
  cashAmount: { type: Number, default: 0, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  // Additional-charge rows (Installation, Freight, etc.) folded into the
  // Quotation Amount total but never rendered as their own visible row.
  hiddenCharge: { type: Boolean, default: false },
}, { _id: false });

const orderFormSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },

  // ─── Customer block ─────────────────────────────────────────────
  customerName: { type: String, trim: true },
  mobile: { type: String, trim: true },
  email: { type: String, trim: true },
  companyName: { type: String, trim: true },
  gstNumber: { type: String, trim: true },
  companyAddress: { type: String, trim: true },
  state: { type: String, trim: true },
  pin: { type: String, trim: true },

  // ─── Order meta block ────────────────────────────────────────────
  quotationNo: { type: String, trim: true },
  orderType: { type: String, trim: true },
  orderFormOrderId: { type: String, trim: true },
  orderDate: { type: Date },
  deliveryDate: { type: Date },
  issueDate: { type: Date },

  // ─── Payment Details block ───────────────────────────────────────
  receivedAmount: { type: Number, default: 0, min: 0 },
  paymentType: { type: String, trim: true },
  balanceAmount: { type: Number, default: 0, min: 0 },
  wayOfPayment: { type: String, trim: true },
  paymentReceiverAC: { type: String, trim: true },
  paymentDate: { type: Date },

  // ─── Item table ───────────────────────────────────────────────────
  items: [orderFormItemSchema],

  totals: {
    qty: { type: Number, default: 0 },
    billAmount: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    quotationAmount: { type: Number, default: 0 },
    cashAmount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
  },

  // How much THIS form currently contributes to Customer.outstandingAmount
  // (Bill Amount minus the originating lead's advance payment). Tracked so
  // resubmission/return can adjust the customer's running balance by the
  // delta instead of double-counting. 0 while the form is 'Returned'.
  outstandingContribution: { type: Number, default: 0 },

  // ─── Lifecycle ────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['Submitted', 'Returned'],
    default: 'Submitted',
  },
  filledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedAt: { type: Date },

  returnRemark: { type: String, trim: true, default: '' },
  returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  returnedAt: { type: Date, default: null },

  lastEditedByAccounts: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  lastEditedAt: { type: Date, default: null },
}, { timestamps: true });

orderFormSchema.index({ companyId: 1, status: 1 });
orderFormSchema.index({ leadId: 1 });

export default mongoose.model('OrderForm', orderFormSchema);
