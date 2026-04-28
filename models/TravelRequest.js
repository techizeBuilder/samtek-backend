/** @format */
import mongoose, { Schema } from "mongoose";

const TravelRequestSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    purpose: {
      type: String,
      required: true,
    },

    destination: {
      type: String,
      required: true,
    },

    fromDate: {
      type: Date,
      required: true,
    },

    toDate: {
      type: Date,
      required: true,
    },

    budget: {
      type: Number,
      required: true,
    },

    payable: {
      type: Number,
    },

    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PAID"],
      default: "UNPAID",
    },

    receiptUrl: {
      type: String,
    },

    remarks: String,

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "PAID"],
      default: "PENDING",
    },
  },
  { timestamps: true },
);

export default mongoose.model("TravelRequest", TravelRequestSchema);
