import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    unit: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: ['Production', 'Operational', 'Other'],
        default: 'Operational'
    },
    expenseType: {
        type: String,
        required: true,
        trim: true
        // e.g., Flour, Sugar, Gas, Electricity, Rent, Salary, Fuel, etc.
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    paymentMode: {
        type: String,
        enum: ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Credit Card'],
        default: 'Cash'
    },
    notes: {
        type: String,
        trim: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Indexes for common queries
expenseSchema.index({ companyId: 1 });
expenseSchema.index({ unit: 1 });
expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1 });

export default mongoose.model('Expense', expenseSchema);
