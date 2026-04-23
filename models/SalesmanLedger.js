import mongoose from 'mongoose';

const salesmanLedgerSchema = new mongoose.Schema({
    salesmanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    date: {
        type: Date,
        required: true,
        index: true
    },
    transactionType: {
        type: String,
        enum: ['Debit', 'Credit'],
        required: true
    },
    entryType: {
        type: String,
        enum: [
            'Cash Deposit',
            'Shortage',
            'Advance',
            'Salary',
            'Commission',
            'Expense Reimbursement',
            'Incentive',
            'Opening Balance'
        ],
        required: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    runningBalance: {
        type: Number,
        default: 0
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        required: false
    },
    referenceType: {
        type: String,
        required: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

// Index for getting historical entries for running balance
salesmanLedgerSchema.index({ salesmanId: 1, date: 1, createdAt: 1 });

const SalesmanLedger = mongoose.model('SalesmanLedger', salesmanLedgerSchema);
export default SalesmanLedger;
