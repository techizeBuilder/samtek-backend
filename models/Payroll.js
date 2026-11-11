/** @format */

import mongoose, { Schema } from "mongoose";

const PayrollSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    month: {
      type: String,
      required: true,
    },

    gross: {
      type: Number,
      required: true,
    },

    deduction: {
      type: Number,
      required: true,
    },

    net: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["Draft", "Processed", "Paid", "Rejected"],
      default: "Draft",
    },
    payDays: {
      type: Number,
      default: 0,
    },
    lopDays: {
      type: Number,
      default: 0,
    },

    // Worked out on the server from attendance, leave and holidays (2026-11-11).
    // Rows saved before then don't have these.
    workingDays: { type: Number },
    earned: { type: Number },
    fixedDeduction: { type: Number },
    lopAmount: { type: Number },
    workedOnOff: { type: Number },
    days: { type: Schema.Types.Mixed },

    rejectReason: {
      type: String,
    },

    rejectedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

/* 🔒 One payroll per employee per month */
PayrollSchema.index({ employee: 1, month: 1 }, { unique: true });

export default mongoose.model("Payroll", PayrollSchema);
