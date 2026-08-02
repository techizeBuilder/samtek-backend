/** @format */
import { Schema, model } from "mongoose";

const AttendancePolicySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },
    graceTime: { type: Number, default: 10 },
    lateAfter: { type: Number, default: 15 },
    lateCountHalfDay: { type: Number, default: 3 },
    earlyExitMinutes: { type: Number, default: 30 },
    overtimeEnabled: { type: Boolean, default: true },
    overtimeAfter: { type: Number, default: 8 },
    overtimeType: {
      type: String,
      enum: ["Paid", "Compensatory Off", "Unpaid"],
      default: "Paid",
    },
  },
  { timestamps: true }
);

// One attendance policy document per company
AttendancePolicySchema.index({ companyId: 1 }, { unique: true });

export const AttendancePolicy = model("AttendancePolicy", AttendancePolicySchema);
