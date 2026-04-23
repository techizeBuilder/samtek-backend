import mongoose from 'mongoose';

const batchPlanSchema = new mongoose.Schema({
  planId: {
    type: String,
    required: true,
    unique: true
  },
  indentId: {
    type: String,
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  requiredQuantity: {
    type: Number,
    required: true
  },
  unitManager: {
    type: String,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  startTime: {
    type: String,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  status: {
    type: String,
    enum: ['Planned', 'Approved', 'Scheduled', 'In Queue', 'In Progress', 'Completed', 'Cancelled'],
    default: 'Planned'
  },
  notes: {
    type: String,
    default: ''
  },
  documents: [{
    name: String,
    url: String,
    uploadedAt: Date
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  }
}, {
  timestamps: true
});

const productionBatchSchema = new mongoose.Schema({
  batchId: {
    type: String,
    required: true,
    unique: true
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BatchPlan',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  plannedQuantity: {
    type: Number,
    required: true
  },
  currentQuantity: {
    type: Number,
    default: 0
  },
  actualQuantity: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Ready', 'In Progress', 'Paused', 'Completed', 'Cancelled'],
    default: 'Ready'
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  actualStartTime: {
    type: Date
  },
  actualEndTime: {
    type: Date
  },
  unitManager: {
    type: String,
    required: true
  },
  productionHead: {
    type: String
  },
  machine: {
    type: String,
    required: true
  },
  shift: {
    type: String,
    required: true
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  remarks: {
    type: String,
    default: ''
  },
  usedMaterials: [{
    name: String,
    plannedQuantity: Number,
    actualQuantity: Number,
    unit: String,
    cost: Number
  }],
  damages: [{
    description: String,
    quantity: Number,
    cost: Number,
    reportedAt: Date,
    reportedBy: String
  }],
  qualityGrade: {
    type: String,
    enum: ['A', 'B', 'C', 'D'],
    default: 'A'
  },
  efficiency: {
    type: Number,
    default: 0
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  }
}, {
  timestamps: true
});

const productionRecordSchema = new mongoose.Schema({
  recordId: {
    type: String,
    required: true,
    unique: true
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductionBatch',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  plannedQuantity: {
    type: Number,
    required: true
  },
  actualProducedQuantity: {
    type: Number,
    required: true
  },
  damagesLosses: {
    type: Number,
    default: 0
  },
  productionHeadName: {
    type: String,
    required: true
  },
  machineUsed: {
    type: String,
    required: true
  },
  shiftDetails: {
    type: String,
    required: true
  },
  startDateTime: {
    type: Date,
    required: true
  },
  endDateTime: {
    type: Date,
    required: true
  },
  totalDuration: {
    type: String,
    required: true
  },
  qualityGrade: {
    type: String,
    enum: ['A', 'B', 'C', 'D'],
    required: true
  },
  efficiency: {
    type: Number,
    required: true
  },
  rawMaterialsUsed: [{
    name: String,
    planned: Number,
    actual: Number,
    unit: String,
    variance: Number,
    cost: Number
  }],
  damageDetails: [{
    description: String,
    quantity: Number,
    cost: Number,
    damageType: String
  }],
  remarks: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['Completed', 'Verified', 'Pending Verification', 'Rejected'],
    default: 'Completed'
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verificationDate: {
    type: Date
  },
  verificationRemarks: {
    type: String
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  }
}, {
  timestamps: true
});

const productionVerificationSchema = new mongoose.Schema({
  verificationId: {
    type: String,
    required: true,
    unique: true
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductionBatch',
    required: true
  },
  recordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductionRecord',
    required: true
  },
  reportedQuantity: {
    type: Number,
    required: true
  },
  verifiedQuantity: {
    type: Number,
    required: true
  },
  reportedDamages: {
    type: Number,
    required: true
  },
  verifiedDamages: {
    type: Number,
    required: true
  },
  qualityAssessment: {
    type: String,
    enum: ['Acceptable', 'Excellent', 'Needs Improvement', 'Rejected'],
    required: true
  },
  approvalStatus: {
    type: String,
    enum: ['Approved', 'Rejected', 'Send Back'],
    required: true
  },
  approvalRemarks: {
    type: String,
    required: true
  },
  nextAction: {
    type: String,
    enum: ['Forward to Packing', 'Send for Quality Control', 'Move to Warehouse', 'Hold for Review'],
    required: true
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  }
}, {
  timestamps: true
});

export const BatchPlan = mongoose.model('BatchPlan', batchPlanSchema);
export const ProductionBatch = mongoose.model('ProductionBatch', productionBatchSchema);
export const ProductionRecord = mongoose.model('ProductionRecord', productionRecordSchema);
export const ProductionVerification = mongoose.model('ProductionVerification', productionVerificationSchema);