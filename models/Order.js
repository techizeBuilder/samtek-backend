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
    enum: ['pending', 'approved', 'rejected', 'in_production', 'completed', 'cancelled'],
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
  quotation: {
    type: String  // Stores base64 PDF content
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