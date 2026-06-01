"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const MarketingAssetSchema = new mongoose_1.default.Schema({
    fileName: { type: String, required: true, trim: true },
    originalName: { type: String, default: '' },
    fileType: { type: String, enum: ['PDF', 'DOC', 'DOCX', 'JPG', 'JPEG', 'PNG', 'WEBP', 'MP4', 'MOV'], required: true },
    fileUrl: { type: String, required: true },
    thumbnail: { type: String, default: '' },
    category: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'MarketingCategory', default: null },
    subcategory: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'MarketingCategory', default: null },
    product: { type: String, default: '', trim: true },
    description: { type: String, default: '' },
    tags: [{ type: String, trim: true }],
    versionNumber: { type: String, default: '1.0' },
    shareCount: { type: Number, default: 0 },
    uploadedBy: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });
MarketingAssetSchema.index({ company: 1, fileType: 1 });
MarketingAssetSchema.index({ company: 1, category: 1 });
MarketingAssetSchema.index({ company: 1, tags: 1 });
exports.default = mongoose_1.default.model('MarketingAsset', MarketingAssetSchema);
