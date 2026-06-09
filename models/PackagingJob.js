import mongoose from 'mongoose';

const ChecklistSchema = new mongoose.Schema({
  allPartsIncluded: { type: Boolean, default: false },
  accessoriesIncluded: { type: Boolean, default: false },
  manualIncluded: { type: Boolean, default: false },
  invoiceCopyIncluded: { type: Boolean, default: false },
  safetyPackingCompleted: { type: Boolean, default: false },
}, { _id: false });

const PackagingJobSchema = new mongoose.Schema({
  jobId: { type: String },  // uniqueness enforced via compound index: { company, jobId }
  productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: false },
  qcJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCJob', required: false },
  orderId: { type: String, required: true },
  machineCode: { type: String, required: true, trim: true },
  machineName: { type: String, required: true, trim: true },
  serialNumber: { type: String },  // uniqueness enforced via compound index: { company, serialNumber }
  packingType: {
    type: String,
    enum: ['Wooden Packing', 'Bubble Wrap', 'Loose Dispatch'],
    default: 'Wooden Packing',
  },
  checklist: { type: ChecklistSchema, default: () => ({}) },
  packingStartTime: { type: String, default: null },
  packingCompleteTime: { type: String, default: null },
  photoProofUrl: { type: String, default: '' },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Packed', 'Dispatched'],
    default: 'Pending',
  },
  notes: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

PackagingJobSchema.index({ company: 1, status: 1 });
// Compound unique indexes: same jobId/serialNumber allowed across companies, not within same company
PackagingJobSchema.index({ company: 1, jobId: 1 }, { unique: true, sparse: true });
PackagingJobSchema.index({ company: 1, serialNumber: 1 }, { unique: true, sparse: true });
PackagingJobSchema.index(
  { company: 1, productionOrderId: 1 },
  { unique: true, partialFilterExpression: { productionOrderId: { $exists: true, $type: 'objectId' } } }
);

export default mongoose.model('PackagingJob', PackagingJobSchema);
