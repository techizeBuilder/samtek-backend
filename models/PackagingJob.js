import mongoose from 'mongoose';

const PackagingJobSchema = new mongoose.Schema({
  jobId: { type: String },  // uniqueness enforced via compound index: { company, jobId }
  productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: false },
  qcJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCJob', required: false },
  orderId: { type: String, required: true },
  machineCode: { type: String, required: true, trim: true },
  machineName: { type: String, required: true, trim: true },
  serialNumber: { type: String },  // uniqueness enforced via compound index: { company, serialNumber }
  // Which specific Sale item (Sale.items._id) this job packs — used to verify
  // full-order packing coverage before dispatch. Null on legacy jobs.
  saleItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // Machines are packed one job per physical unit (each with its own serial):
  // unitIndex = 1..N of the item's qty. Non-machine items pack as a single
  // job with quantity = the item's qty.
  unitIndex: { type: Number, default: 1, min: 1 },
  quantity: { type: Number, default: 1, min: 1 },
  packingType: {
    type: String,
    enum: ['Wooden Packing', 'Bubble Wrap', 'Loose Dispatch'],
    default: 'Wooden Packing',
  },
  // Keyed by the admin-defined dispatch checklist item's _id (from AdminSettings.dispatchChecklist)
  // → Boolean, so checklist items can be added/edited/removed from Admin Settings freely.
  checklist: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
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
// NOTE: the old unique index on { company, productionOrderId } was removed —
// one Production Order with orderQuantity N now packs as N per-unit jobs.
// Duplicate protection is enforced in createPackagingJob via a units-count
// check. Run scripts/migrate_multi_item_flow.js once to drop the old DB index.
PackagingJobSchema.index({ company: 1, productionOrderId: 1 });
PackagingJobSchema.index({ company: 1, orderId: 1 });

export default mongoose.model('PackagingJob', PackagingJobSchema);
