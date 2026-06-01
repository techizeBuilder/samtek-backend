"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Partner = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const partnerSchema = new mongoose_1.default.Schema({
    companyId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    percentage: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });
// Ensure unique partner names per company
partnerSchema.index({ companyId: 1, name: 1 }, { unique: true });
exports.Partner = mongoose_1.default.model('Partner', partnerSchema);
