import mongoose from 'mongoose';

const PROCESS_STEPS = ['Job Work', 'Fabrication', 'Assembly', 'Painting', 'Re-Assembly', 'Final Testing'];
const PROCESS_TYPE_MAP = {
  'Job Work': 'Outsourcing',
  'Fabrication': 'In-House',
  'Assembly': 'In-House',
  'Painting': 'In-House',
  'Re-Assembly': 'In-House',
  'Final Testing': 'In-House',
};

const ReworkSchema = new mongoose.Schema({
  date: { type: String, default: null },
  reason: { type: String, default: '' },
  rejectedBy: { type: String, default: '' },
}, { _id: false });

const SubEntrySchema = new mongoose.Schema({
  parentPart: { type: String, required: true },
  childPart: { type: String, required: true },
  assignedMember: { type: String, required: true },
  fabricationType: { type: String, default: 'Other' },
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
  qcStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  reworks: { type: [ReworkSchema], default: [] },
  createdAt: { type: Date, default: Date.now }
});

const ProcessStepSchema = new mongoose.Schema({
  step: { type: String, required: true },
  type: { type: String, enum: ['Outsourcing', 'In-House'], required: true },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'QC Pending', 'Completed'],
    default: 'Pending',
  },
  assignedTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionTeam', default: null },
  startDate: { type: String, default: null },
  endDate: { type: String, default: null },
  qcStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  qcBy: { type: String, default: null },
  qcDate: { type: String, default: null },
  notes: { type: String, default: '' },
  reworks: { type: [ReworkSchema], default: [] },
  subEntries: { type: [SubEntrySchema], default: [] },
}, { _id: false });

const MaterialDemandSchema = new mongoose.Schema({
  materialCode: { type: String, required: true, trim: true },
  materialName: { type: String, required: true, trim: true },
  bomQuantity: { type: Number, default: null },
  quantity: { type: Number, required: true, min: 0 },

  // ── NEW: 2-Step Fulfillment Tracking ──
  returnPendingQuantity: { type: Number, default: 0, min: 0 },
  transferredQuantity: { type: Number, default: 0, min: 0 }, // Store sent it
  issuedQuantity: { type: Number, default: 0, min: 0 },      // Production received it

  unit: { type: String, required: true },
  status: {
    type: String,
    // Added 'In Transit'
    enum: ['Pending R&D', 'Requested', 'In Transit', 'Issued', 'Pending Purchase', 'R&D Rejected', 'Pending Return'],
    default: 'Pending R&D',
  },
});

const ProductionOrderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  // The real sales Order's orderCode (e.g. "ORD-0066") this run was generated
  // from — resolved via saleId → Sale.order at creation time. Null for
  // manually-created/Stock entries that aren't tied to a customer order.
  orderCode: { type: String, default: null, trim: true },
  machineCode: { type: String, required: true, trim: true },
  machineName: { type: String, required: true, trim: true },
  priority: { type: String, enum: ['Urgent', 'Normal'], default: 'Normal' },
  source: {
    type: String,
    enum: ['Store', 'QC_Rejected', 'Stock'],
    default: 'Store'
  },
  // purpose field removed — use 'source' to distinguish:
  //   'Store' / 'QC_Rejected' = order-triggered → dispatch after QC
  //   'Stock'                 = company stock production → inventory after QC
  rejectionDetails: {
    originalOrderId: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    rejectedDate: { type: String, default: null },
    qcJobId: { type: String, default: null }
  },
  status: {
    type: String,
    enum: ['Pending', 'BOM Pending', 'In Progress', 'On Hold', 'Completed'],
    default: 'Pending',
  },
  receivedDate: { type: String, required: true },
  deliveryDate: { type: String, required: true },
  bomVerified: { type: Boolean, default: false },
  designVerified: { type: Boolean, default: false },
  rdRequestRaised: { type: Boolean, default: false },
  materialIssued: { type: Boolean, default: false },
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notes: { type: String, default: '' },
  processes: {
    type: [ProcessStepSchema], default: () => PROCESS_STEPS.map(step => ({
      step,
      type: PROCESS_TYPE_MAP[step],
      status: 'Pending',
      assignedTeam: null,
      startDate: null,
      endDate: null,
      qcStatus: 'Pending',
      qcBy: null,
      qcDate: null,
      notes: '',
      reworks: [],
    }))
  },
  materialDemands: { type: [MaterialDemandSchema], default: [] },
  // NEW: Store the snapshot of the design URLs
  designDocuments: [{
    name: { type: String },
    fileUrl: { type: String },
    version: { type: String }
  }],
}, { timestamps: true });

ProductionOrderSchema.index({ company: 1, status: 1 });
ProductionOrderSchema.index({ company: 1, priority: 1 });
ProductionOrderSchema.index({ company: 1, createdAt: -1 });

export { PROCESS_STEPS, PROCESS_TYPE_MAP };
export default mongoose.model('ProductionOrder', ProductionOrderSchema);
