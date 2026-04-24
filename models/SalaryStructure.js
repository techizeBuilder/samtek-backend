/** @format */

import mongoose, { Schema } from "mongoose";

const SalaryStructureSchema = new Schema(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // Earnings
    basic: {
      type: Number,
      default: 0,
    },
    hra: {
      type: Number,
      default: 0,
    },
    otherAllowance: {
      type: Number,
      default: 0,
    },

    // Deductions
    pf: {
      type: Number,
      default: 0,
    },
    professionalTax: {
      type: Number,
      default: 0,
    },
    tds: {
      type: Number,
      default: 0,
    },
    advance: {
      type: Number,
      default: 0,
    },
    others: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "SalaryStructure",
  SalaryStructureSchema
);
