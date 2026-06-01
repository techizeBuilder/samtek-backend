"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const productDailySummarySchema = new mongoose_1.default.Schema({
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    productId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Item',
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    // Master Data Fields (Not daily-specific)
    qtyPerBatch: {
        type: Number,
        default: 0,
        min: 0
    }
}, {
    timestamps: true
});
// Unique index: ONE entry per product per company (Master data)
productDailySummarySchema.index({ productId: 1, companyId: 1 }, { unique: true });
// Non-unique indexes for efficient queries
productDailySummarySchema.index({ companyId: 1 });
productDailySummarySchema.index({ productId: 1 });
exports.default = mongoose_1.default.model('ProductDailySummary', productDailySummarySchema);
