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
const dispatchConsoleSchema = new mongoose_1.default.Schema({
    // Tracking fields
    packingSheetId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'PackingSheet',
        required: false, // Optional - not needed for direct orders from dispatch
        index: true
    },
    // Individual product tracking (NEW FIELDS)
    productId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Item',
        required: false, // Will be null for aggregated entries, populated for individual product entries
        index: true
    },
    productName: {
        type: String,
        required: false, // Will be null for aggregated entries, populated for individual product entries
        trim: true
    },
    productGroup: {
        type: String,
        required: true,
        trim: true
    },
    company: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    date: {
        type: Date,
        required: true,
        default: () => {
            const today = new Date();
            return new Date(today.setHours(0, 0, 0, 0));
        },
        index: true
    },
    // Dispatch Console Columns (matching dispatch console UI)
    packedQuantityReadyForDispatch: {
        type: Number,
        default: 0,
        min: [0, 'Packed quantity cannot be negative']
    },
    previousClosingStockYesterdayBalance: {
        type: Number,
        default: 0,
        min: [0, 'Previous closing stock cannot be negative']
    },
    returnQuantityYesterdayReturns: {
        type: Number,
        default: 0,
        min: [0, 'Return quantity cannot be negative']
    },
    totalAvailableStock: {
        type: Number,
        default: 0,
        min: [0, 'Total available stock cannot be negative']
        // Auto-calculated: packing + closing + returns
    },
    totalIndentQuantityOrdersForTheDay: {
        type: Number,
        default: 0,
        min: [0, 'Total indent quantity cannot be negative']
    },
    excessShortage: {
        type: Number,
        default: 0
        // Auto-calculated: available - indent (can be negative for shortage)
    },
    dispatchedQuantitySentToday: {
        type: Number,
        default: 0,
        min: [0, 'Dispatched quantity cannot be negative']
    },
    closingStockEndOfDayBalance: {
        type: Number,
        default: 0
        // Can be negative when dispatched quantity exceeds available stock (shortage)
    },
    physicalStockEntryManualVerification: {
        type: Number,
        default: 0,
        min: [0, 'Physical stock entry cannot be negative']
    },
    overallLoss: {
        type: Number,
        default: 0
        // Auto-calculated: closing - physical (can be negative)
    },
    // Additional tracking fields
    dcno: {
        type: String,
        trim: true,
        sparse: true,
        index: true,
        // Removed strict format match to allow flexible DC formats; uniqueness is enforced per company below
        uppercase: true
    },
    batchNo: {
        type: String,
        trim: true
    },
    remarks: {
        type: String,
        trim: true,
        maxlength: [500, 'Remarks cannot exceed 500 characters']
    },
    verifiedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User'
    },
    verifiedAt: {
        type: Date
    },
    // Delivery Challan specific fields
    salesPerson: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    customer: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Customer',
        index: true
    },
    orderId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Order'
    },
    indentQty: {
        type: Number,
        default: 0
    },
    qtyIssued: {
        type: Number,
        default: 0
    },
    approvedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: {
        type: Date
    },
    invoiceGenerated: {
        type: Boolean,
        default: false
    },
    invoiceGeneratedAt: {
        type: Date
    },
    vehicleNumber: {
        type: String,
        trim: true
    },
    transporterName: {
        type: String,
        trim: true
    },
    notes: {
        type: String,
        trim: true
    },
    unit: {
        type: String,
        trim: true
    },
    // Status and tracking
    status: {
        type: String,
        enum: ['pending', 'updated', 'verified', 'dispatched', 'completed', 'approved'],
        default: 'pending',
        index: true
    },
    lastUpdatedBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});
// Indexes for performance optimization
// Removed unique constraint to allow multiple dispatch entries per product (for different salesperson-customer combinations)
dispatchConsoleSchema.index({ packingSheetId: 1, productId: 1, date: 1 }, { name: 'packingSheetId_productId_date' });
dispatchConsoleSchema.index({ company: 1, date: 1 }, { name: 'company_date_index' });
dispatchConsoleSchema.index({ productGroup: 1, date: 1 }, { name: 'product_group_date_index' });
dispatchConsoleSchema.index({ status: 1, date: 1 }, { name: 'status_date_index' });
dispatchConsoleSchema.index({ salesPerson: 1, customer: 1, date: 1 }, { name: 'salesperson_customer_date_index' });
// Virtual field to check if entry is editable
dispatchConsoleSchema.virtual('isEditable').get(function () {
    return ['pending', 'updated'].includes(this.status);
});
// Virtual field to check if entry is verified
dispatchConsoleSchema.virtual('isVerified').get(function () {
    return ['verified', 'dispatched', 'completed'].includes(this.status);
});
// Auto-calculate dependent fields before saving
dispatchConsoleSchema.pre('save', function (next) {
    // Calculate totalAvailableStock = packing + closing + returns
    this.totalAvailableStock =
        (this.packedQuantityReadyForDispatch || 0) +
            (this.previousClosingStockYesterdayBalance || 0) +
            (this.returnQuantityYesterdayReturns || 0);
    // Calculate excessShortage = indent - available (positive = shortage, negative = excess)
    this.excessShortage =
        (this.totalIndentQuantityOrdersForTheDay || 0) -
            (this.totalAvailableStock || 0);
    // Calculate closingStockEndOfDayBalance = totalAvailableStock - dispatchedQuantity
    this.closingStockEndOfDayBalance =
        (this.totalAvailableStock || 0) -
            (this.dispatchedQuantitySentToday || 0);
    // Calculate overallLoss = closingStock - physicalStock
    this.overallLoss =
        (this.closingStockEndOfDayBalance || 0) -
            (this.physicalStockEntryManualVerification || 0);
    next();
});
// Auto-calculate fields when updating
dispatchConsoleSchema.pre('findOneAndUpdate', function (next) {
    const update = this.getUpdate();
    if (update.$set) {
        // Recalculate dependent fields if relevant fields are being updated
        const relevantFields = [
            'packedQuantityReadyForDispatch',
            'previousClosingStockYesterdayBalance',
            'returnQuantityYesterdayReturns',
            'totalIndentQuantityOrdersForTheDay',
            'dispatchedQuantitySentToday',
            'physicalStockEntryManualVerification'
        ];
        const hasRelevantUpdates = relevantFields.some(field => update.$set[field] !== undefined);
        if (hasRelevantUpdates) {
            const packing = update.$set.packedQuantityReadyForDispatch || 0;
            const closing = update.$set.previousClosingStockYesterdayBalance || 0;
            const returns = update.$set.returnQuantityYesterdayReturns || 0;
            const indent = update.$set.totalIndentQuantityOrdersForTheDay || 0;
            const dispatched = update.$set.dispatchedQuantitySentToday || 0;
            const physical = update.$set.physicalStockEntryManualVerification || 0;
            // Calculate dependent fields
            const totalAvailable = packing + closing + returns;
            update.$set.totalAvailableStock = totalAvailable;
            update.$set.excessShortage = indent - totalAvailable;
            // Calculate closingStockEndOfDayBalance = totalAvailableStock - dispatchedQuantity
            const closingStock = totalAvailable - dispatched;
            update.$set.closingStockEndOfDayBalance = closingStock;
            // Calculate overallLoss = closingStock - physicalStock  
            update.$set.overallLoss = closingStock - physical;
        }
    }
    next();
});
// Static method to generate next DCno
dispatchConsoleSchema.statics.generateNextDCno = function (companyId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Find the highest DCno in the database
            const lastDispatch = yield this.findOne({ dcno: { $regex: /^DC\d+$/ } }, { dcno: 1 }).sort({ dcno: -1 }).lean();
            let nextNumber = 1;
            if (lastDispatch && lastDispatch.dcno) {
                // Extract number from DCno (e.g., "DC003" -> 3)
                const lastNumber = parseInt(lastDispatch.dcno.substring(2));
                nextNumber = lastNumber + 1;
            }
            // Generate next DCno with zero padding
            const nextDCno = `DC${nextNumber.toString().padStart(3, '0')}`;
            console.log(`✅ Generated DCno: ${nextDCno} (Note: Multiple products can share this DC number)`);
            return nextDCno;
        }
        catch (error) {
            console.error('Error generating DCno:', error);
            // Fallback to timestamp-based DCno in case of error
            const timestamp = Date.now().toString().slice(-6);
            return `DC${timestamp}`;
        }
    });
};
// Static method to get dispatch summary for a date range
dispatchConsoleSchema.statics.getDispatchSummary = function (companyId, startDate, endDate) {
    return __awaiter(this, void 0, void 0, function* () {
        return this.aggregate([
            {
                $match: {
                    company: companyId,
                    date: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$productGroup',
                    totalPacked: { $sum: '$packedQuantityReadyForDispatch' },
                    totalDispatched: { $sum: '$dispatchedQuantitySentToday' },
                    totalClosing: { $sum: '$closingStockEndOfDayBalance' },
                    totalLoss: { $sum: '$overallLoss' },
                    count: { $sum: 1 },
                    avgExcessShortage: { $avg: '$excessShortage' }
                }
            },
            {
                $sort: { totalPacked: -1 }
            }
        ]);
    });
};
// Compound indexes for efficient queries
dispatchConsoleSchema.index({ packingSheetId: 1, productId: 1, date: 1 }); // Remove unique constraint temporarily
dispatchConsoleSchema.index({ company: 1, date: 1 }); // For daily dashboard queries
dispatchConsoleSchema.index({ productGroup: 1, date: 1 }); // For group-wise reporting
// Ensure DC number uniqueness per company (prevents duplicate DC within same company)
dispatchConsoleSchema.index({ company: 1, dcno: 1 }, { unique: true, sparse: true, name: 'company_dcno_unique' });
// Note: If you have a unique index on dcno in your database, drop it using:
// db.dispatches.dropIndex("dcno_1")
// The dcno field should NOT be unique as multiple products can share the same DC number
exports.default = mongoose_1.default.model('Dispatch', dispatchConsoleSchema);
