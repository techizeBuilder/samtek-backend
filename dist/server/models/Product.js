"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const productSchema = new mongoose_1.default.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    brandId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Brand',
        required: true
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    image: {
        type: String,
        default: 'default-product.jpg'
    },
    description: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});
// Add virtual for brand details
productSchema.virtual('brand', {
    ref: 'Brand',
    localField: 'brandId',
    foreignField: '_id',
    justOne: true
});
// Ensure virtual fields are included in JSON output
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });
exports.default = mongoose_1.default.model('Product', productSchema);
