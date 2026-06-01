"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const ParameterSchema = new mongoose_1.default.Schema({
    parameter: { type: String, required: true, trim: true },
    tolerance: { type: String, default: '' },
    performanceStandard: { type: String, default: '' },
});
const QCItemSchema = new mongoose_1.default.Schema({
    item: { type: String, required: true, trim: true },
    checked: { type: Boolean, default: false },
});
const RDQualityParamSchema = new mongoose_1.default.Schema({
    machine: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
    machineName: { type: String, required: true },
    parameters: { type: [ParameterSchema], default: [] },
    qcChecklist: { type: [QCItemSchema], default: [] },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
RDQualityParamSchema.index({ company: 1, machine: 1 }, { unique: true });
exports.default = mongoose_1.default.model('RDQualityParam', RDQualityParamSchema);
