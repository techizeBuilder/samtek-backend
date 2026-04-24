/** @format */

import mongoose, { Schema } from "mongoose";

const FeedbackAndRatingsSchema = new Schema(
  {
    selfAppraisalId: {
      type: Schema.Types.ObjectId,
      ref: "SelfAppraisal",
      required: true,
      unique: true,
    },

    employeeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    reviewerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    managerRatings: {
      goals: { type: Number, required: true },
      skills: { type: Number, required: true },
      behaviour: { type: Number, required: true },
      overall: { type: Number, required: true },
    },

    feedback: { type: String },
    recommendation: {
      type: String,
      enum: ["PROMOTE", "HIKE", "PIP", "NO_CHANGE"],
      default: "NO_CHANGE",
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "FeedbackAndRatings",
  FeedbackAndRatingsSchema
);
