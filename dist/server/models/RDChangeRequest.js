"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const RDChangeRequestSchema = new mongoose_1.default.Schema({
    changeId: { type: String, unique: true },
    machine: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
    machineName: { type: String, required: true },
    machineCode: { type: String, required: true },
    raisedBy: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    changeType: {
        type: String,
        enum: ['Material', 'Design', 'Tool', 'Process', 'Other'],
        required: true,
    },
    description: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    rdNotes: { type: String, default: '' },
    raisedAt: { type: String },
    resolvedAt: { type: String, default: null },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
RDChangeRequestSchema.index({ company: 1, status: 1 });
RDChangeRequestSchema.index({ company: 1, machine: 1 });
exports.default = mongoose_1.default.model('RDChangeRequest', RDChangeRequestSchema);
