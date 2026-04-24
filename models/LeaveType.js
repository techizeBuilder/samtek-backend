/** @format */

import mongoose, { Schema } from "mongoose";

const LeaveTypeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    maxDays: {
      type: Number,
      required: true,
    },
    paid: {
      type: Boolean,
      default: false,
    },
    carryForward: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("LeaveType", LeaveTypeSchema);
