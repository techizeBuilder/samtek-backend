/** @format */

import mongoose, { Schema } from "mongoose";

const attendanceRequestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true },
    type: { type: String, required: true },
    punchIn: String,
    punchOut: String,
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    adminRemark: String,
  },
  { timestamps: true }
);

export default mongoose.model("AttendanceRequest", attendanceRequestSchema);
