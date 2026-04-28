/** @format */

import mongoose, { Schema } from "mongoose";

const ProfileUpdateSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updateType: {
      type: String,
      required: true,
      enum: ["Address", "Phone", "Bank", "Emergency", "Other"],
    },

    newValue: {
      type: String,
      required: true,
      trim: true,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
  },
  { timestamps: true },
);

export default mongoose.model("ProfileUpdate", ProfileUpdateSchema);
