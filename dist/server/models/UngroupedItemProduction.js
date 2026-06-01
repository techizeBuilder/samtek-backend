"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const ungroupedItemProductionSchema = new mongoose_1.default.Schema({
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    itemId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Item',
        required: true
    },
    // Batch number for supporting individual batch tracking
    batchNumber: {
        type: Number,
        default: 1,
        min: 1
    },
    // Formatted batch number (BATNO01, BATNO02, etc.)
    batchNo: {
        type: String,
        default: 'BATNO01'
    },
    // Production Timing Fields
    mouldingTime: {
        type: Date,
        default: null
    },
    unloadingTime: {
        type: Date,
        default: null
    },
    // Production Data Fields
    productionLoss: {
        type: Number,
        default: 0,
        min: 0
    },
    qtyPerBatch: {
        type: Number,
        default: 0,
        min: 0
    },
    // Auto-calculated field
    qtyAchieved: {
        type: Number,
        default: 0,
        min: 0
    },
    // Production Date (for daily tracking)
    productionDate: {
        type: Date,
        default: () => new Date().setHours(0, 0, 0, 0) // Start of day
    },
    // Status tracking
    status: {
        type: String,
        enum: ['not_started', 'in_progress', 'completed'],
        default: 'not_started'
    },
    // Metadata
    createdBy: {
        type: String,
        required: true
    },
    updatedBy: {
        type: String
    },
    // Auto-update qtyAchieved when productionLoss or qtyPerBatch changes
    notes: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});
// Compound index to ensure one production record per batch per day per company
// This allows the same item to have multiple batches on the same day
ungroupedItemProductionSchema.index({ companyId: 1, batchNo: 1, productionDate: 1 }, { unique: true });
// Pre-save middleware to calculate qtyAchieved
ungroupedItemProductionSchema.pre('save', function (next) {
    // Auto-calculate qtyAchieved = qtyPerBatch - productionLoss
    this.qtyAchieved = Math.max(0, (this.qtyPerBatch || 0) - (this.productionLoss || 0));
    // Update status based on timing data
    if (this.mouldingTime && this.unloadingTime) {
        this.status = 'completed';
    }
    else if (this.mouldingTime) {
        this.status = 'in_progress';
    }
    else {
        this.status = 'not_started';
    }
    next();
});
// Instance method to get formatted timing data
ungroupedItemProductionSchema.methods.getFormattedTimings = function () {
    return {
        mouldingTime: this.mouldingTime ? {
            date: this.mouldingTime.toLocaleDateString(),
            time: this.mouldingTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        } : null,
        unloadingTime: this.unloadingTime ? {
            date: this.unloadingTime.toLocaleDateString(),
            time: this.unloadingTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        } : null
    };
};
// Static method to get or create production record for today with batch support
ungroupedItemProductionSchema.statics.getOrCreateTodayRecord = function (companyId_1, itemId_1, createdBy_1) {
    return __awaiter(this, arguments, void 0, function* (companyId, itemId, createdBy, batchNumber = 1) {
        const today = new Date().setHours(0, 0, 0, 0);
        let record = yield this.findOne({
            companyId,
            itemId,
            batchNumber,
            productionDate: today
        });
        if (!record) {
            record = new this({
                companyId,
                itemId,
                batchNumber,
                productionDate: today,
                createdBy
            });
            yield record.save();
        }
        return record;
    });
};
const UngroupedItemProduction = mongoose_1.default.model('UngroupedItemProduction', ungroupedItemProductionSchema);
exports.default = UngroupedItemProduction;
