"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/** @format */
const mongoose_1 = __importDefault(require("mongoose"));
const userDocumentSchema = new mongoose_1.default.Schema({
    userId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ["AADHAAR", "PAN", "MARKSHEET_12", "PASSBOOK"]
    },
    fileUrl: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ["UPLOADED", "VERIFIED", "REJECTED"],
        default: "UPLOADED"
    }
}, {
    timestamps: true
});
exports.default = mongoose_1.default.model('UserDocument', userDocumentSchema);
