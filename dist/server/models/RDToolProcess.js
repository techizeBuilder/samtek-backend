"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const ToolSchema = new mongoose_1.default.Schema({
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    specification: { type: String, default: '' },
    quantity: { type: Number, default: 1, min: 0 },
    unit: { type: String, default: 'pcs' },
    isDiscontinued: { type: Boolean, default: false },
});
const ProcessSchema = new mongoose_1.default.Schema({
    step: { type: Number, required: true },
    type: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    duration: { type: String, default: '' },
    tool: { type: String, default: '' },
});
const RDToolProcessSchema = new mongoose_1.default.Schema({
    machine: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
    tools: { type: [ToolSchema], default: [] },
    processes: { type: [ProcessSchema], default: [] },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
RDToolProcessSchema.index({ company: 1, machine: 1 }, { unique: true });
exports.default = mongoose_1.default.model('RDToolProcess', RDToolProcessSchema);
