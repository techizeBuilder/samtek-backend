/** @format */
import { Schema, model } from "mongoose";

const HrPolicySchema = new Schema(
  {
    no: { type: Number, required: true },
    name: { type: String, required: true },
    requirements: [{ type: String }],
    legalReference: { type: String, default: "" },
    documentUrl: { type: String, default: "" },
    documentName: { type: String, default: "" },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: false,
    },
  },
  { timestamps: true }
);

// unique per company (no + companyId combination must be unique)
HrPolicySchema.index({ no: 1, companyId: 1 }, { unique: true });

export const HrPolicy = model("HrPolicy", HrPolicySchema);
