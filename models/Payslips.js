/** @format */

import mongoose, { Schema } from "mongoose";

const PayslipSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    payroll: {
      type: Schema.Types.ObjectId,
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
  },
  { timestamps: true }
);

/* 🔐 One payslip per employee per month */
PayslipSchema.index({ user: 1, month: 1 }, { unique: true });

export default mongoose.model("Payslip", PayslipSchema);
