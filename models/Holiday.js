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
  },
  {
    timestamps: true,
  }
);

// Indexes (optional but recommended)
holidaySchema.index({ date: 1 });
holidaySchema.index({ isActive: 1 });

export default mongoose.model("Holiday", holidaySchema);
