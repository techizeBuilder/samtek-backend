"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const MarketingShareLogSchema = new mongoose_1.default.Schema({
    action: { type: String, enum: ['Upload', 'Edit', 'Delete', 'Share'], required: true },
    asset: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'MarketingAsset', default: null },
    assetName: { type: String, default: '' },
    performedBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    // Share-specific fields
    shareMethod: { type: String, enum: ['WhatsApp', 'Email', ''], default: '' },
    customerName: { type: String, default: '' },
    customerPhone: { type: String, default: '' },
    customerEmail: { type: String, default: '' },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });
MarketingShareLogSchema.index({ company: 1, action: 1 });
MarketingShareLogSchema.index({ company: 1, createdAt: -1 });
MarketingShareLogSchema.index({ company: 1, asset: 1 });
exports.default = mongoose_1.default.model('MarketingShareLog', MarketingShareLogSchema);
