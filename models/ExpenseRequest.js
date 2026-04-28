/** @format */
import mongoose, { Schema } from "mongoose";

const ExpenseRequestSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    expenseType: {
      type: String,
      required: true,
    },

    subCategory: {
      type: String,
    },

    billingType: {
      type: String,
      enum: ["Chargeable", "Non-Chargeable"],
      default: "Non-Chargeable",
      required: true,
    },

    travelRequestId: {
      type: Schema.Types.ObjectId,
      ref: "TravelRequest",
    },

    amount: {
      type: Number,
      required: true,
    },

    date: {
      type: Date,
      required: true,
    },

    remarks: {
      type: String,
    },

    receipt: {
      type: String, // file URL
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "PAID"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

export default mongoose.model("ExpenseRequest", ExpenseRequestSchema);
