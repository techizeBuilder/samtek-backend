import mongoose from 'mongoose';

const orderProductSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  machineDetails: [{
    serialNumber: { type: String, trim: true },

    // Warranty tracks the free period after purchase
    warrantyExpiryDate: { type: Date },

    // AMC tracks the paid contract period after warranty expires
    amcExpiryDate: { type: Date },

    // The physical PDF agreement mentioned in Point 12
    amcDocumentUrl: { type: String }
  }]
});

const orderSchema = new mongoose.Schema({
  orderCode: {
    type: String,
    required: true,
    unique: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  salesPerson: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company is required']
  },
  unit: {
    type: String,
    trim: true
  },
  orderDate: {
    type: Date,
    required: true
  },
  products: [orderProductSchema],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'pending_service_approval', 'rejected_by_service', 'approved', 'rejected', 'in_production', 'completed', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  rejectionReason: {
    type: String
  },
  productionStartDate: {
    type: Date
  },
  productionEndDate: {
    type: Date
  },
  requestedDeliveryDate: {
    type: Date
  },
  actualDeliveryDate: {
    type: Date
  },
  statusHistory: [{
    status: {
      type: String,
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false  // Made optional to handle legacy data
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    remarks: {
      type: String
    }
  }],
  notes: {
    type: String,
    trim: true
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  gst: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Paid', 'Partial', 'Due'],
    default: 'Pending'
  },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Credit Card', 'Bank Transfer', 'Check', 'Other'],
    default: 'Cash'
  },
  paymentDate: {
    type: Date
  },
  accountApproval: {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: {
      type: Date
    },
    remarks: {
      type: String
    }
  },
  // 🔄 SERVICE VERIFICATION (New Flow Addition)
  serviceVerification: {
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending'
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    verifiedAt: {
      type: Date
    },
    callRecordingUrl: {
      type: String
    },
    isFakeCommitmentChecked: {
      type: Boolean,
      default: false
    },
    remarks: {
      type: String
    }
  },
  // 📋 LEAD REFERENCE (For tracking Lead-to-Order conversion)
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead'
  },
  quotation: {
    type: String  // Stores base64 PDF content
  },
  // 📋 SALES CHECKLIST (Filled by Sales Employee during Deal Won, verified by Service Team)
  salesChecklist: {
    type: mongoose.Schema.Types.Mixed,
    default: {
      advancePayment: { checked: false, value: 0, verified: false },
      installationCharge: { checked: false, value: '', verified: false },
      warranty: { checked: false, value: '', verified: false },
      boardingLodging: { checked: false, value: '', verified: false },
      backupGenerator: { checked: false, value: '', verified: false },
      operatorErrorClause: { checked: false, verified: false }
    }
  },
  // 📝 ORDER FORM GATE — Store cannot see/act on this order until the sales
  // Order Form (OrderForm model) has been submitted for it. Flipped false again
  // if Accounts returns the form to the salesperson for correction.
  orderFormCompleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for better query performance
orderSchema.index({ customer: 1 });
orderSchema.index({ salesPerson: 1 });
orderSchema.index({ companyId: 1 });
orderSchema.index({ unit: 1 });
orderSchema.index({ orderDate: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ priority: 1 });
orderSchema.index({ orderFormCompleted: 1 });

// Update status history when status changes
orderSchema.pre('save', async function () {
  if (this.isModified('status') && !this.isNew) {
    this.statusHistory.push({
      status: this.status,
      updatedBy: this._updatedBy || null,
      updatedAt: new Date(),
      remarks: this._statusRemarks || ''
    });
  }
});

export default mongoose.model('Order', orderSchema);