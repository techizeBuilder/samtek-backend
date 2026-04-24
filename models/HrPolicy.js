/** @format */
import { Schema, model } from "mongoose";

const HrPolicySchema = new Schema(
  {
    no: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    requirements: [{ type: String }],
    legalReference: { type: String, default: "" },
    documentUrl: { type: String, default: "" },
    documentName: { type: String, default: "" },
  },
  { timestamps: true }
);

export const HrPolicy = model("HrPolicy", HrPolicySchema);
