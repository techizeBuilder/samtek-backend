import mongoose from 'mongoose';

const ChecklistItemSchema = new mongoose.Schema({
  parameter: { type: String, required: true },
  standardValue: { type: String, default: '' },
  actualValue: { type: String, default: '' },
  status: { type: String, enum: ['Pending', 'Pass', 'Fail'], default: 'Pending' },
  remarks: { type: String, default: '' },
}, { _id: true });

const QCJobSchema = new mongoose.Schema({
  qcJobId: { type: String, unique: true },

  // Source info
  source: {
    type: String,
    enum: ['Purchase', 'Production', 'Store', 'QC_Rejected', 'Stock'],
    required: true,
  },
  sourceRefId: { type: String, default: '' },   // orderId / PO number / stock ref
  sourceDepartment: { type: String, default: '' },
  sentBy: { type: String, default: '' },

  // Item info
  itemName: { type: String, required: true, trim: true },
  itemCode: { type: String, default: '', trim: true },
  category: {
    type: String,
    required: true,
  },
  quantity: { type: Number, default: 1 },
  unit: { type: String, default: 'pcs' },
  receivedDate: { type: String, required: true },

  // Inspection
  inspector: { type: String, default: '' },
  inspectionStartDate: { type: String, default: null },
  inspectionEndDate: { type: String, default: null },
  checklist: [ChecklistItemSchema],

  // Decision
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Approved', 'Rejected'],
    default: 'Pending',
  },
  decision: { type: String, enum: ['', 'Pass', 'Fail'], default: '' },
  failReason: { type: String, default: '' },
  inspectorRemarks: { type: String, default: '' },

  // Attachments
  attachments: [{ url: String, type: { type: String, enum: ['Image', 'Video', 'Document'] }, label: String }],

  // Back-reference to the Purchase Request that originated this QC job (Purchase source only)
  purchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', default: null },
  // Back-reference to the Sale that originated this QC job (Store source only)
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },

  // Post-decision
  transferredToStore: { type: Boolean, default: false },
  returnedToSource: { type: Boolean, default: false },

  notes: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

QCJobSchema.index({ company: 1, status: 1 });
QCJobSchema.index({ company: 1, source: 1 });

export default mongoose.model('QCJob', QCJobSchema);
