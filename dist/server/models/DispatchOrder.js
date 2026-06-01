"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const DispatchOrderSchema = new mongoose_1.default.Schema({
    dispatchId: { type: String, unique: true },
    packagingJobId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'PackagingJob', required: true },
    productionOrderId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'ProductionOrder', required: false },
    qcJobId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'QCJob', required: false },
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
    // Service & Feedback
    customerConfirmation: {
        status: { type: String, enum: ['Pending', 'Reached Safely', 'Issue'], default: 'Pending' },
        remarks: { type: String, default: '' },
        confirmedAt: { type: Date }
    },
    installation: {
        status: { type: String, enum: ['Pending', 'Scheduled', 'Completed'], default: 'Pending' },
        scheduledDate: { type: Date },
        technicianName: { type: String, default: '' },
        remarks: { type: String, default: '' }
    },
    feedback: {
        rating: { type: Number, min: 1, max: 5 },
        comments: { type: String, default: '' },
        collectedAt: { type: Date }
    },
    notes: { type: String, default: '' },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
DispatchOrderSchema.index({ company: 1, status: 1 });
DispatchOrderSchema.index({ company: 1, packagingJobId: 1 }, { unique: true });
exports.default = mongoose_1.default.model('DispatchOrder', DispatchOrderSchema);
