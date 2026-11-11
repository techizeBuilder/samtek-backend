/** @format */

import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    date: {
      type: Date,
      required: true,
    },

    day: {
      type: String,
      required: true,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    // Paid unless HR marks it Unpaid (2026-11-11). Payroll pays a paid holiday.
    paid: {
      type: Boolean,
      default: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes (optional but recommended)
holidaySchema.index({ date: 1 });
holidaySchema.index({ isActive: 1 });

export default mongoose.model("Holiday", holidaySchema);
