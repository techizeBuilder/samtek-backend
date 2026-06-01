"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const TEST_RESULT = ['Pass', 'Fail', 'Pending', 'In Progress'];
const RDPrototypeSchema = new mongoose_1.default.Schema({
    machine: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'RDMachine', required: true },
    machineName: { type: String, required: true },
    machineCode: { type: String, required: true },
    prototypeName: { type: String, required: true, trim: true },
    performanceTest: { type: String, enum: TEST_RESULT, default: 'Pending' },
    outputTest: { type: String, enum: TEST_RESULT, default: 'Pending' },
    durabilityTest: { type: String, enum: TEST_RESULT, default: 'Pending' },
    status: { type: String, enum: ['In Progress', 'Passed', 'Failed'], default: 'In Progress' },
    testNotes: { type: String, default: '' },
    passedDate: { type: String, default: null },
    testedBy: { type: String, default: '' },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
    createdBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
RDPrototypeSchema.index({ company: 1, machine: 1 });
RDPrototypeSchema.index({ company: 1, status: 1 });
exports.default = mongoose_1.default.model('RDPrototype', RDPrototypeSchema);
