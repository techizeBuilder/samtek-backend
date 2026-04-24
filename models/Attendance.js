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
      enum: ["PRESENT", "ABSENT"],
      default: "PRESENT",
    },
  },
  { timestamps: true }
);

AttendanceSchema.index({ user: 1, date: 1 }, { unique: true });

export default mongoose.model("Attendance", AttendanceSchema);
