/** @format */

import mongoose, { Schema } from "mongoose";

const resignationSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    resignationType: {
      type: String,
      required: true,
    },
    reasonCategory: {
      type: String,
      required: true,
    },
    reasonText: {
      type: String,
      required: true,
    },
    expectedLastWorkingDay: {
      type: Date,
      required: true,
    },
    documents: String,
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    adminRemark: String,
  },
  { timestamps: true }
);

export default mongoose.model("Resignation", resignationSchema);
