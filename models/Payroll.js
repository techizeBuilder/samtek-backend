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
