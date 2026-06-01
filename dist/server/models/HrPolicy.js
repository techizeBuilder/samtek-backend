"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HrPolicy = void 0;
/** @format */
const mongoose_1 = require("mongoose");
const HrPolicySchema = new mongoose_1.Schema({
    no: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    requirements: [{ type: String }],
    legalReference: { type: String, default: "" },
    documentUrl: { type: String, default: "" },
    documentName: { type: String, default: "" },
}, { timestamps: true });
exports.HrPolicy = (0, mongoose_1.model)("HrPolicy", HrPolicySchema);
