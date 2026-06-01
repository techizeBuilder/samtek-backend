"use strict";
/** @format */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const { Schema } = mongoose_1.default;
const DesignationSchema = new Schema({
    companyId: {
        type: Schema.Types.ObjectId,
        ref: "Company",
        required: true,
    },
    departmentId: {
        type: Schema.Types.ObjectId,
        ref: "Department",
        required: false,
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    status: {
        type: String,
        enum: ["Active", "Inactive"],
        default: "Active",
    },
}, { timestamps: true });
exports.default = mongoose_1.default.model("Designation", DesignationSchema);
