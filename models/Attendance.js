/** @format */

import mongoose, { Schema } from "mongoose";

const BreakSchema = new Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date },
    duration: { type: Number, default: 0 },
  },
  { _id: false }
);

const AttendanceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    date: {
      type: String,
      required: true,
    },

    punchIn: Date,
    punchOut: Date,

    breaks: {
      type: [BreakSchema],
      default: [],
    },

    totalBreakSeconds: {
      type: Number,
      default: 0,
    },

    totalWorkSeconds: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["PRESENT", "ABSENT", "HALF_DAY", "WEEKLY_OFF"],
      default: "PRESENT",
    },

    // Where this day came from (2026-11-11): Device, or Correction for an approved
    // Attendance Request. Older records have none and count as self-marked. The
    // device sync only ever overwrites its own.
    source: { type: String, enum: ["Device", "Correction"] },
    deviceCode: { type: String },
    deviceStatus: { type: String },
    deviceRemark: { type: String },
    overtimeSeconds: { type: Number, default: 0 },
    lateSeconds: { type: Number, default: 0 },
    earlyOutSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AttendanceSchema.index({ user: 1, date: 1 }, { unique: true });

export default mongoose.model("Attendance", AttendanceSchema);
