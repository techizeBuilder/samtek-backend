import mongoose, { Schema } from "mongoose";

const LeaveBalanceAdjustmentSchema = new Schema(
    {
        employee: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        leaveType: {
            type: String,
            required: true,
            index: true,
        },
        oldBalance: {
            type: Number,
            required: true,
        },
        newBalance: {
            type: Number,
            required: true,
        },
        adjustment: {
            type: Number,
            required: true,
        },
        reason: {
            type: String,
            required: true,
        },
        addedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        effectiveDate: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

export default mongoose.model("LeaveBalanceAdjustment", LeaveBalanceAdjustmentSchema);
