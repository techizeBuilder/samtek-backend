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
    // Weekly off days, 0 = Sunday … 6 = Saturday (2026-11-11). For people not on the
    // device; the device's own WO counts for those on it. Not working days for payroll.
    weeklyOffDays: { type: [Number], default: [0] },
    // Shifts set by HR (2026-11-12), any times, as many as the company has. Not
    // set per person: each day a person's shift is the one whose start is
    // nearest their punch-in. The lunch is taken out of production step hours.
    // HH:MM; an end before the start crosses midnight.
    shifts: {
      type: [{
        name: { type: String, trim: true },
        start: String,
        end: String,
        lunchFrom: String,
        lunchTo: String,
      }],
      default: [],
    },
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
