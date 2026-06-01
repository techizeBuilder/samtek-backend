"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const RDMachineSchema = new mongoose_1.default.Schema({
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    designStatus: {
        type: String,
        enum: ['Draft', 'Testing', 'Approved', 'Rejected'],
        default: 'Draft',
    },
    releaseStatus: {
        type: String,
        enum: ['Not Released', 'Released'],
        default: 'Not Released',
    },
    machineType: { type: String, enum: ['Standard', 'Custom', 'Special Purpose Machine (SPM)'], default: 'Standard' },
    isDiscontinued: { type: Boolean, default: false },
    rejectionNote: { type: String, default: '' },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
RDMachineSchema.index({ company: 1, designStatus: 1 });
RDMachineSchema.index({ company: 1, isDiscontinued: 1 });
exports.default = mongoose_1.default.model('RDMachine', RDMachineSchema);
