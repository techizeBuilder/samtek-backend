import mongoose from 'mongoose';

const TechnicianSchema = new mongoose.Schema({
  technicianId: { type: String, default: '' },
  technicianName: { type: String, default: '' }
}, { _id: false });

const DispatchOrderSchema = new mongoose.Schema({
  dispatchId: { type: String },  // uniqueness enforced via compound index: { company, dispatchId }
  packagingJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackagingJob', required: true },
  productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: false },
  qcJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCJob', required: false },
  orderId: { type: String, required: true },
  machineCode: { type: String, required: true, trim: true },
  machineName: { type: String, required: true, trim: true },
  serialNumber: { type: String, required: true },
  // Which specific Sale item (Sale.items._id) this dispatch line covers, and
  // how many units it carries (non-machine items dispatch as one line with
  // quantity = item qty; machines are one line per unit). Null/1 on legacy.
  saleItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  quantity: { type: Number, default: 1, min: 1 },

  // Customer / destination
  customerName: { type: String, default: '' },
  customerContact: { type: String, default: '' },
  customerEmail: { type: String, default: '' },
  deliveryAddress: { type: String, default: '' },

  // Transport
  transportType: {
    type: String,
    enum: ['Local Transport', 'Transport Company', 'Courier'],
    default: 'Transport Company',
  },
  vehicleNumber: { type: String, default: '' },
  driverName: { type: String, default: '' },
  driverContact: { type: String, default: '' },
  transportCompanyName: { type: String, default: '' },

  // Dates
  plannedDispatchDate: { type: String, default: null },
  actualDispatchDate: { type: String, default: null },
  expectedDeliveryDate: { type: String, default: null },
  actualDeliveryDate: { type: String, default: null },

  // Tracking
  trackingId: { type: String, default: '' },

  // Status
  status: {
    type: String,
    enum: ['Ready', 'Dispatched', 'In Transit', 'Delivered', 'Closed'],
    default: 'Ready',
  },

  // Delivery proof
  deliveryProofUrl: { type: String, default: '' },
  deliveryOTP: { type: String, default: '' },
  deliveryOTPVerified: { type: Boolean, default: false },

  // Delivery documents (required before confirming delivery)
  deliveryDocs: {
    noc: { type: String, default: '' },         // NOC file path
    ewayBill: { type: String, default: '' },    // E-Way Bill file path
    invoice: { type: String, default: '' },     // Invoice file path
  },

  // Documents
  invoiceNumber: { type: String, default: '' },
  packingListNotes: { type: String, default: '' },

  // Service & Feedback
  customerConfirmation: {
    status: { type: String, enum: ['Pending', 'Reached Safely', 'Issue'], default: 'Pending' },
    remarks: { type: String, default: '' },
    confirmedAt: { type: Date }
  },
  installation: {
    status: { type: String, enum: ['Pending', 'Scheduled', 'Completed'], default: 'Pending' },
    scheduledDate: { type: Date },
    // Comma-joined names, kept for backward compatibility with older records
    // and any code that still reads a single technician string.
    technicianName: { type: String, default: '' },
    // Multiple technicians can now be assigned to one installation.
    technicians: { type: [TechnicianSchema], default: [] },
    remarks: { type: String, default: '' }
  },
  feedback: {
    rating: { type: Number, min: 1, max: 5 },
    comments: { type: String, default: '' },
    collectedAt: { type: Date },
    submittedViaForm: { type: Boolean, default: false }, // true = customer filled the form themselves
    feedbackToken: { type: String, default: null, index: true },
    feedbackTokenExpiry: { type: Date, default: null }
  },

  notes: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

DispatchOrderSchema.index({ company: 1, status: 1 });
// Compound unique: same dispatchId allowed across companies, not within same company
DispatchOrderSchema.index({ company: 1, dispatchId: 1 }, { unique: true, sparse: true });
DispatchOrderSchema.index({ company: 1, packagingJobId: 1 }, { unique: true });

export default mongoose.model('DispatchOrder', DispatchOrderSchema);
