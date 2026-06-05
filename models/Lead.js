import mongoose from 'mongoose';

const leadHistorySchema = new mongoose.Schema({
  action: {
    type: String,
    required: true
  },
  notes: String,
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const leadSchema = new mongoose.Schema({
  leadCode: {
    type: String,
    required: true
    // unique enforced via compound index: { companyId, leadCode }
  },
  leadDate: {
    type: Date,
    default: Date.now
  },
  closureDate: Date,
  dealValue: {
    type: Number,
    default: 0
  },
  quotation: String,
  productRequired: {
    type: String,
    required: true
  },
  describeRequirements: String,
  source: {
    type: String,
    required: true,
    default: 'Direct Visit'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  observer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  paymentCheckStatus: {
    type: String,
    enum: ['Not Requested', 'Pending', 'Paid', 'Partially Paid', 'Rejected'],
    default: 'Not Requested'
  },
  sentToAccount: {
    type: Boolean,
    default: false
  },
  sentToAccountDate: Date,
  advancedPaymentAmount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    default: 'New'
  },
  stage: {
    type: String,
    default: 'N/A'
  },
  nextFollowUpDate: Date,
  
  // Buyer / Company Details
  companyName: {
    type: String,
    required: true
  },
  country: {
    type: String,
    default: 'India'
  },
  contactPerson: {
    type: String,
    required: true
  },
  designation: String,
  mobile: {
    type: String,
    required: true
  },
  alternateMobile: String,
  phone: {
    areaCode: String,
    number: String
  },
  alternatePhone: {
    areaCode: String,
    number: String
  },
  email: {
    type: String,
    required: true
  },
  alternateEmail: String,
  address: String,
  state: String,
  city: String,
  pincode: String,
  customerType: String,
  gstNumber: String,
  pan: String,
  iec: String,
  tan: String,
  cin: String,
  website: String,
  profile: String,
  reference: String,
  
  // Multi-tenancy
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  
  documents: [{
    type: { type: String }, // Aadhaar, GST, etc.
    name: String,
    url: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  
  contacts: [{
    contactPerson: { type: String, required: true },
    designation: String,
    department: String,
    email: String,
    mobile: String,
    alternateEmail: String,
    alternateMobile: String,
    address: String,
    country: String,
    state: String,
    city: String,
    pincode: String,
    gstNumber: String,
    dob: Date,
    anniversary: Date,
    createdAt: { type: Date, default: Date.now }
  }],
  
  notes: [{
    content: { type: String, required: true },
    userName: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  
  history: [leadHistorySchema]
}, {
  timestamps: true
});

// Compound unique index: same leadCode allowed in different companies, but not within same company
leadSchema.index({ companyId: 1, leadCode: 1 }, { unique: true });

// Index for performance
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ mobile: 1 });
leadSchema.index({ email: 1 });

export default mongoose.model('Lead', leadSchema);
