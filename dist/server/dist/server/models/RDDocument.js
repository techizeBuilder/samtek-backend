"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const RDDocumentSchema = new mongoose_1.default.Schema({
    machine: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
    machineCode: { type: String, required: true },
    machineName: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    type: {
        type: String,
        enum: ['Design Files', 'BOM', 'Process Sheet', 'QC Checklist', 'User Manual', 'Test Report', 'Certificate', 'Specification', 'Other'],
        required: true,
    },
    version: { type: String, default: 'v1.0' },
    size: { type: String, default: '' },
    fileUrl: { type: String, default: '' },
    originalName: { type: String, default: '' },
    notes: { type: String, default: '' },
    uploadedBy: { type: String, required: true },
    uploadedAt: { type: String },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
RDDocumentSchema.index({ company: 1, machine: 1 });
exports.default = mongoose_1.default.model('RDDocument', RDDocumentSchema);
