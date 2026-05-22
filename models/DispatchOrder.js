import mongoose from 'mongoose';

const DispatchOrderSchema = new mongoose.Schema({
  dispatchId: { type: String, unique: true },
  packagingJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackagingJob', required: true },
  productionOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionOrder', required: false },
  qcJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCJob', required: false },
  orderId: { type: String, required: true },
  machineCode: { type: String, required: true, trim: true },
  machineName: { type: String, required: true, trim: true },
  serialNumber: { type: String, required: true },

  // Customer / destination
  customerName: { type: String, default: '' },
  customerContact: { type: String, default: '' },
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

  // Documents
  invoiceNumber: { type: String, default: '' },
  packingListNotes: { type: String, default: '' },

  notes: { type: String, default: '' },
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

DispatchOrderSchema.index({ company: 1, status: 1 });
DispatchOrderSchema.index({ company: 1, packagingJobId: 1 }, { unique: true });

export default mongoose.model('DispatchOrder', DispatchOrderSchema);
