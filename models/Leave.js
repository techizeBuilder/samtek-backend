/** @format */

import mongoose, { Schema } from "mongoose";

const LeaveSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    leaveType: {
      type: String,
      required: true,
    },

    fromDate: {
      type: Date,
      required: true,
    },

    toDate: {
      type: Date,
      required: true,
    },

    totalDays: {
      type: Number,
      required: true,
    },

    reason: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },

    remainingLeaves: {
      type: Number,
      default: 12, // static for now
    },
  },
  { timestamps: true }
);

export default mongoose.model("Leave", LeaveSchema);
