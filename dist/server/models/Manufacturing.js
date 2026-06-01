"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const schema_js_1 = require("../shared/schema.js");
const materialUsageSchema = new mongoose_1.default.Schema({
    materialId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Inventory',
        required: true
    },
    materialName: {
        type: String,
        required: true
    },
    quantityUsed: {
        type: Number,
        required: true,
        min: 0
    },
    unit: {
        type: String,
        required: true
    }
});
const manufacturingSchema = new mongoose_1.default.Schema({
    jobNumber: {
        type: String,
        required: true,
        unique: true
    },
    order: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    plannedQuantity: {
        type: Number,
        required: true,
        min: 1
    },
    actualQuantity: {
        type: Number,
        default: 0,
        min: 0
    },
    status: {
        type: String,
        enum: Object.values(schema_js_1.PRODUCTION_STATUS),
        default: schema_js_1.PRODUCTION_STATUS.PENDING
    },
    startDate: {
        type: Date,
        required: true
    },
    expectedEndDate: {
        type: Date,
        required: true
    },
    actualEndDate: {
        type: Date
    },
    unit: {
        type: String,
        required: true
    },
    assignedWorkers: [{
            type: mongoose_1.default.Schema.Types.ObjectId,
            ref: 'User'
        }],
    machineUsed: {
        type: String
    },
    materialUsage: [materialUsageSchema],
    qualityCheckPassed: {
        type: Boolean,
        default: false
    },
    notes: {
        type: String
    },
    efficiency: {
        type: Number,
        min: 0,
        max: 100
    }
}, {
    timestamps: true
});
manufacturingSchema.pre('save', function (next) {
    if (!this.jobNumber) {
        this.jobNumber = `JOB-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }
    next();
});
exports.default = mongoose_1.default.model('Manufacturing', manufacturingSchema);
