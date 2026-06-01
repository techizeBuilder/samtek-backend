"use strict";
/** @format */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const PayslipSchema = new mongoose_1.Schema({
    user: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    payroll: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Payroll",
        required: true,
        index: true,
    },
    month: {
        type: String, // YYYY-MM
        required: true,
        index: true,
    },
    /* ===== Earnings ===== */
    basic: {
        type: Number,
        required: true,
    },
    hra: {
        type: Number,
        required: true,
    },
    otherAllowance: {
        type: Number,
        default: 0,
    },
    /* ===== Deductions ===== */
    deduction: {
        type: Number,
        default: 0,
    },
    pf: {
        type: Number,
        default: 0,
    },
    professionalTax: {
        type: Number,
        default: 0,
    },
    tds: {
        type: Number,
        default: 0,
    },
    advance: {
        type: Number,
        default: 0,
    },
    others: {
        type: Number,
        default: 0,
    },
    payDays: {
        type: Number,
        default: 30,
    },
    lopDays: {
        type: Number,
        default: 0,
    },
    /* ===== YTD Snapshots ===== */
    ytdBasic: { type: Number, default: 0 },
    ytdHra: { type: Number, default: 0 },
    ytdOtherAllowance: { type: Number, default: 0 },
    ytdPf: { type: Number, default: 0 },
    ytdProfessionalTax: { type: Number, default: 0 },
    ytdTds: { type: Number, default: 0 },
    ytdAdvance: { type: Number, default: 0 },
    ytdOthers: { type: Number, default: 0 },
    /* ===== Final ===== */
    netSalary: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ["Generated", "Sent", "Viewed"],
        default: "Generated",
    },
    pdfPath: {
        type: String,
    },
    sentAt: {
        type: Date,
    },
    viewedAt: {
        type: Date,
    },
}, { timestamps: true });
/* 🔐 One payslip per employee per month */
PayslipSchema.index({ user: 1, month: 1 }, { unique: true });
exports.default = mongoose_1.default.model("Payslip", PayslipSchema);
