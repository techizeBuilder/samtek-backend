/** @format */

import mongoose, { Schema } from "mongoose";

const jobOpeningSchema = new Schema(
  {
    jobTitle: {
      type: String,
      required: true,
      trim: true,
    },

    department: {
      type: String,
      required: true,
      trim: true,
    },

    location: {
      type: String,
      required: true,
      trim: true,
    },

    openings: {
      type: Number,
      required: true,
      min: 1,
    },

    recruitingManager: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },

    jobDocument: {
      type: String,
    },

    status: {
      type: String,
      enum: ["Open", "Closed"],
      default: "Open",
    },
  },
  {
    timestamps: true, // Posted On yahin se aayega
  }
);

export default mongoose.model("JobOpening", jobOpeningSchema);
