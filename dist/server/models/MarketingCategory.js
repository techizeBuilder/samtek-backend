"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const MarketingCategorySchema = new mongoose_1.default.Schema({
    name: { type: String, required: true, trim: true },
    parentCategory: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'MarketingCategory', default: null },
    company: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Company', required: true },
}, { timestamps: true });
MarketingCategorySchema.index({ company: 1, parentCategory: 1 });
exports.default = mongoose_1.default.model('MarketingCategory', MarketingCategorySchema);
