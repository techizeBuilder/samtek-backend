/** @format */

import mongoose, { Schema } from "mongoose";

const candidateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    jobId: { type: Schema.Types.ObjectId, ref: "JobOpening", required: true },
    jobTitle: { type: String, required: true },
    recruitingManager: { type: String, trim: true },
    mobile: { type: String, required: true, trim: true },
    resumeUrl: { type: String, required: true },
    hiringDate: { type: Date },
    joiningDate: { type: Date },

    status: {
      type: String,
      enum: ["Applied", "Shortlisted", "Rejected", "Hired"],
      default: "Applied",
    },
    applied: { type: Boolean, default: true },
    shortlisted: { type: Boolean, default: false },
    hrRound: { type: Boolean, default: false },
    techRound: { type: Boolean, default: false },
    offer: { type: Boolean, default: false },
    hired: { type: Boolean, default: false },
    feedback: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("Candidate", candidateSchema);
