import mongoose from 'mongoose';

const salesmanDailySettlementSchema = new mongoose.Schema({
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
    totalInvoiceSale: {
        type: Number,
        default: 0
    },
    totalReturn: {
        type: Number,
        default: 0
    },
    cashSale: {
        type: Number,
        default: 0
    },
    creditSale: {
        type: Number,
        default: 0
    },
    expectedCash: {
        type: Number,
        default: 0
    },
    actualCash: {
        type: Number,
        default: 0
    },
    transactionType: {
        type: String,
        enum: ['Debit', 'Credit'],
        default: 'Credit'
    },
    entryType: {
        type: String,
        required: true
    },
    bankAccountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        default: null
    },
    difference: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['Shortage', 'Excess', 'Clear'],
        default: 'Clear'
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    settledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    notes: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Calculate status and difference before saving
salesmanDailySettlementSchema.pre('save', function (next) {
    this.difference = this.actualCash - this.expectedCash;

    if (this.difference < 0) {
        this.status = 'Shortage';
    } else if (this.difference > 0) {
        this.status = 'Excess';
    } else {
        this.status = 'Clear';
    }

    next();
});

const SalesmanDailySettlement = mongoose.model('SalesmanDailySettlement', salesmanDailySettlementSchema);
export default SalesmanDailySettlement;
