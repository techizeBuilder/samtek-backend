"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROCESS_TYPE_MAP = exports.PROCESS_STEPS = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const PROCESS_STEPS = ['Job Work', 'Fabrication', 'Assembly', 'Painting', 'Re-Assembly', 'Final Testing'];
exports.PROCESS_STEPS = PROCESS_STEPS;
const PROCESS_TYPE_MAP = {
    'Job Work': 'Outsourcing',
    'Fabrication': 'In-House',
    'Assembly': 'In-House',
    'Painting': 'In-House',
    'Re-Assembly': 'In-House',
    'Final Testing': 'In-House',
};
exports.PROCESS_TYPE_MAP = PROCESS_TYPE_MAP;
const ReworkSchema = new mongoose_1.default.Schema({
    date: { type: String, default: null },
    reason: { type: String, default: '' },
    rejectedBy: { type: String, default: '' },
}, { _id: false });
const ProcessStepSchema = new mongoose_1.default.Schema({
    step: { type: String, required: true },
    type: { type: String, enum: ['Outsourcing', 'In-House'], required: true },
    status: {
        type: String,
        enum: ['Pending', 'In Progress', 'QC Pending', 'Completed'],
        default: 'Pending',
    },
    assignedTeam: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'ProductionTeam', default: null },
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    qcStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    qcBy: { type: String, default: null },
    qcDate: { type: String, default: null },
    notes: { type: String, default: '' },
    reworks: { type: [ReworkSchema], default: [] },
}, { _id: false });
const MaterialDemandSchema = new mongoose_1.default.Schema({
    materialCode: { type: String, required: true, trim: true },
    materialName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    status: {
        type: String,
        enum: ['Requested', 'Issued', 'Pending Purchase'],
        default: 'Requested',
    },
});
const ProductionOrderSchema = new mongoose_1.default.Schema({
    orderId: { type: String, unique: true },
    machineCode: { type: String, required: true, trim: true },
    machineName: { type: String, required: true, trim: true },
    priority: { type: String, enum: ['Urgent', 'Normal'], default: 'Normal' },
    source: {
        type: String,
        enum: ['Store', 'QC_Rejected'],
        default: 'Store'
    },
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
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: '' },
    processes: { type: [ProcessStepSchema], default: () => PROCESS_STEPS.map(step => ({
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
        })) },
    materialDemands: { type: [MaterialDemandSchema], default: [] },
}, { timestamps: true });
ProductionOrderSchema.index({ company: 1, status: 1 });
ProductionOrderSchema.index({ company: 1, priority: 1 });
ProductionOrderSchema.index({ company: 1, createdAt: -1 });
exports.default = mongoose_1.default.model('ProductionOrder', ProductionOrderSchema);
