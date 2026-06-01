"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try {
            step(generator.next(value));
        }
        catch (e) {
            reject(e);
        } }
        function rejected(value) { try {
            step(generator["throw"](value));
        }
        catch (e) {
            reject(e);
        } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const PackingItemSchema = new mongoose_1.default.Schema({
    productId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Inventory',
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    indentQty: {
        type: Number,
        default: 0,
        min: 0
    },
    producedQty: {
        type: Number,
        default: 0,
        min: 0
    },
    packedQty: {
        type: Number,
        default: 0,
        min: 0
    },
    packingLoss: {
        type: Number,
        default: 0,
        min: 0
    },
    notes: {
        type: String,
        default: ''
    }
}, {
    _id: false // Don't create separate _id for subdocuments
});
const PackingSheetSchema = new mongoose_1.default.Schema({
    slNo: {
        type: Number,
        required: true
    },
    productionGroup: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'ProductionGroup',
        required: false,
        default: null
    },
    productionGroupName: {
        type: String,
        required: true
    },
    batchId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'ProductionBatch',
        required: false,
        default: null
    },
    batchNo: {
        type: String,
        required: false,
        default: null
    },
    packingStartTime: {
        type: Date,
        default: null
    },
    packingEndTime: {
        type: Date,
        default: null
    },
    packingLoss: {
        type: Number,
        default: 0,
        min: 0
    },
    notes: {
        type: String,
        default: ''
    },
    totalPackedQty: {
        type: Number,
        default: 0,
        min: 0
    },
    updatedPackedQty: {
        type: Number,
        default: 0,
        min: 0
    },
    items: [PackingItemSchema],
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'approved', 'paused'],
        default: 'pending'
    },
    // Approval tracking
    approvedAt: {
        type: Date,
        default: null
    },
    approvedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    // Company and user tracking
    company: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    lastUpdatedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // Date tracking for daily sheets
    packingDate: {
        type: Date,
        default: () => new Date().setHours(0, 0, 0, 0) // Start of current day
    },
    shift: {
        type: String,
        enum: ['morning', 'evening', 'night'],
        default: 'morning'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});
// Compound indexes for efficient queries
PackingSheetSchema.index({ company: 1, packingDate: 1, isActive: 1 });
PackingSheetSchema.index({ productionGroup: 1, packingDate: 1 });
PackingSheetSchema.index({ status: 1, packingDate: 1 });
PackingSheetSchema.index({ slNo: 1, company: 1 }, { unique: true });
// Methods
PackingSheetSchema.methods.startPacking = function () {
    this.packingStartTime = new Date();
    this.status = 'in_progress';
    return this.save();
};
PackingSheetSchema.methods.endPacking = function () {
    this.packingEndTime = new Date();
    this.status = 'completed';
    return this.save();
};
PackingSheetSchema.methods.calculateTotalPacked = function () {
    this.totalPackedQty = this.items.reduce((total, item) => total + item.packedQty, 0);
    return this.totalPackedQty;
};
// Pre-save middleware
PackingSheetSchema.pre('save', function (next) {
    // Auto-calculate total packed quantity
    this.totalPackedQty = this.items.reduce((total, item) => total + item.packedQty, 0);
    next();
});
// Static method to get next available serial number
PackingSheetSchema.statics.getNextSlNo = function (companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        const lastSheet = yield this.findOne({ company: companyId })
            .sort({ slNo: -1 })
            .select('slNo');
        return lastSheet ? lastSheet.slNo + 1 : 1;
    });
};
// Static method to get today's packing sheets
PackingSheetSchema.statics.getTodaySheets = function (companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        const today = new Date();
        const startOfDay = new Date(today.setHours(0, 0, 0, 0));
        const endOfDay = new Date(today.setHours(23, 59, 59, 999));
        return this.find({
            company: companyId,
            packingDate: { $gte: startOfDay, $lte: endOfDay },
            isActive: true
        });
    });
};
exports.default = mongoose_1.default.model('PackingSheet', PackingSheetSchema);
